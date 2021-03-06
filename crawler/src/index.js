const chalk = require('chalk');
const figlet = require('figlet');
const puppeteer = require('puppeteer');
const $ = require('cheerio');
const { Client } = require('@elastic/elasticsearch')
const client = new Client({ node: 'http://localhost:9200' })
const normalizeUrl = require('normalize-url');
const Rx = require('rxjs');
const RxOp = require('rxjs/operators');
//import { queueScheduler, Subject } from 'rxjs';


console.log(chalk.yellow(figlet.textSync('Web Crawler', {horizontalLayout: 'full' })));

const argv = require('minimist')(process.argv.slice(2));

if (argv.url === undefined || argv.whitelisturls === undefined) {
    console.error('Usage: `npm run crawler -- --url={site-base-url} --whitelisturls=insim.biz,nn-engineering.dev`');
    process.exit(1);
}

mainAsync();

async function mainAsync() {
    const url = normalizeUrl(argv.url);
    const baseUrl = url; // starting point, we do not escape from this domain

    console.log(`Going to crawl root site ${url}`);
    process.env.NODE_TLS_REJECT_UNAUTHORIZED=0  

    const seenUrls = [];

    const browser = await puppeteer.launch()
    const queue = new Rx.Subject();
    queue.pipe(
        RxOp.map((url) => normalizeUrl(url)),
        RxOp.filter((url) => !seenUrls.find(seenUrl => seenUrl === url)),
        RxOp.concatMap((url) => fetchAndParsePage(browser, url)),
        RxOp.mergeMap((parsedPageObject) => index(parsedPageObject)),
        RxOp.tap((result) => { 
            seenUrls.push(result.url); 
            // only go deeper with our crawl on the same domain
            result.urls
                .filter(u => u.startsWith(baseUrl))
                .forEach(u => queue.next(u));
        })
    )
    .subscribe(
        (result) => console.log('downloaded and indexed url: ' + result.url),
        (err) => console.error('Error: ' + err)
    );

    queue.next(url);
}




async function fetchAndParsePage(browser, url) {
    console.log('Going to fetch url: ', url);
    const page = await browser.newPage();
    const html = await page.goto(url).then(() => page.content());
    return await parsePageContents(html, url);
}

// take the page contents and extract any follow up urls to crawl
async function parsePageContents(html, url) {
    const urls = [];
    $('a', html).each((i, link) => {
        const href = $(link).attr('href');

        if (href.startsWith('#')) {
            urls.push(url + href);
            return;
        }

        if (!href.startsWith('https://')) {
            return; // only extract https page urls for now, skip stuff like 'mailto
        }

        urls.push(href);
    });

    const parsed = {
        content: html,
        title: $('title', html).text(),
        url: url,
        domain: 'something-todo',
        crawled_at: new Date().toISOString(),
        urls: urls.map(u => normalizeUrl(u)).filter(onlyUnique), //dedupe and normalize
    };
    return parsed;
}

// source from https://stackoverflow.com/a/14438954/106909
function onlyUnique(value, index, self) {
    return self.indexOf(value) === index;
}

// index the given page object to our search engine
async function index(pageObject) {
    console.log('going to index', pageObject.url);
    // index it!
    try {    
        //await Promise.resolve('FOO');
        const indexResult = await client.index({
            index: 'webpages',
            body: { ...pageObject }
        });
        // console.log('indexed into ES', indexResult);
    }
    catch (error) {
        console.log('error while indexing', error);
    }
    return pageObject; // chain the object for easy usage
}