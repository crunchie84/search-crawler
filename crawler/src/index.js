const chalk = require('chalk');
const figlet = require('figlet');
const puppeteer = require('puppeteer');
const $ = require('cheerio');
const { Client } = require('@elastic/elasticsearch')
const client = new Client({ node: 'http://localhost:9200' })
const normalizeUrl = require('normalize-url');


console.log(chalk.yellow(figlet.textSync('Web Crawler', {horizontalLayout: 'full' })));

const argv = require('minimist')(process.argv.slice(2));

if (argv.url === undefined || argv.whitelisturls === undefined) {
    console.error('Usage: `npm run crawler -- --url={site-base-url} --whitelisturls=insim.biz,nn-engineering.dev`');
    process.exit(1);
}

 


mainAsync()
.then(() => console.log('done...'), (err) => console.error('error: '+err));

async function mainAsync() {
    const url = normalizeUrl(argv.url);

    console.log(`Going to crawl root site ${url}`);
    process.env.NODE_TLS_REJECT_UNAUTHORIZED=0  

    const seenUrls = [];

    const browser = await puppeteer.launch()
    const parsed = await fetchPage(browser, url);
    await index(parsed);
    seenUrls.push(url);
}

async function fetchPage(browser, url) {
    const page = browser.newPage();
    const html = await page.goto(url).then(() => page.content());
    const parsed = await parsePageContents(html);
    return parsed;
}



async function crawlAndIndex(url, urlsIndexed) {
    const result = await crawl(url);
    const parsed = await parsePageContents(result.pageContents);
    await index({ 
        url: result.pageUrl,
        domain: result.domain,
        title: parsed.title,
        content: parsed.content
    });

    // this url is also indexed
    urlsIndexed.push(url);

    // only return the urls which have not yet been indexed
    const notYetIndexedUrls = parsed.urls.filter(u => !urlsIndexed.any(ui => ui === u));

    return {
        pageUrls: notYetIndexedUrls,
        urlsIndexed
    };
}

/**
 * crawl the given page, return its contents and extract urls
 * @param {} pageUrl 
 * @param {*} whitelistedDomains 
 */
async function crawl(pageUrl) {

    // parse domain from the url

    return {
        url: pageUrl,
        domain: '',
        pageContents: ''
    }
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
            return;
        }
        urls.push(href);
    });

    return {
        content: html,
        title: $('title', html).text(),
        url,
        crawled_at: new Date().toISOString(),
        urls,
    }
}

// index the given page object to our search engine
async function index(pageObject) {
    // index it!
    try{
        const indexResult = await client.index({
            index: 'webpages',
            body: { ...pageObject }
        });
        console.log('indexed into ES', indexResult);
    }
    catch (error) {
        console.log('error while indexing', error);   
    }
}