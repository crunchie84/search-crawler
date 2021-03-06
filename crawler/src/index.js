const chalk = require('chalk');
const figlet = require('figlet');
const puppeteer = require('puppeteer');
const $ = require('cheerio');
const { Client } = require('@elastic/elasticsearch')
const normalizeUrl = require('normalize-url');
const Rx = require('rxjs');
const RxOp = require('rxjs/operators');
//import { queueScheduler, Subject } from 'rxjs';


console.log(chalk.yellow(figlet.textSync('Web Crawler', { horizontalLayout: 'full' })));

const argv = require('minimist')(process.argv.slice(2));

if (argv.url === undefined || argv.whitelisturls === undefined) {
    console.error('Usage: `npm run crawler -- --url={site-base-url} --whitelisturls=insim.biz,nn-engineering.dev`');
    process.exit(1);
}

mainAsync();

async function mainAsync() {
    const client = new Client({ node: 'http://localhost:9200' })

    const url = normalizeUrl(argv.url);
    const baseUrl = url; // starting point, we do not escape from this domain

    console.log(`Going to crawl root site ${url}...`);
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0

    const indexName = await createIndex(client);
    const seenUrls = [];

    const browser = await puppeteer.launch()
    const queue = new Rx.Subject();
    queue.pipe(
        RxOp.map((url) => normalizeUrl(url)),
        RxOp.filter((url) => !seenUrls.find(seenUrl => seenUrl === url)),
        RxOp.concatMap((url) => fetchAndParsePage(browser, url)),
        RxOp.mergeMap((parsedPageObject) => index(indexName, parsedPageObject)),
        RxOp.tap((result) => {
            seenUrls.push(result.url);
            // only go deeper with our crawl on the same domain
            result.outbound_urls
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
        content: $('body', html).text(),
        title: $('title', html).text(),
        url: url,
        crawled_at: new Date().toISOString(),
        outbound_urls: urls
            .map(u => {
                // remove any query params ?=.. stuff
                return u.substr(0, u.indexOf('?')); 
            })
            .map(u => normalizeUrl(u))
            .filter(onlyUnique), //dedupe and normalize
    };
    return parsed;
}

// source from https://stackoverflow.com/a/14438954/106909
function onlyUnique(value, index, self) {
    return self.indexOf(value) === index;
}

// index the given page object to our search engine
async function index(indexName, pageObject) {
    console.log('going to index', pageObject.url);
    // index it!
    try {
        //await Promise.resolve('FOO');
        const indexResult = await client.index({
            index: indexName,
            body: { ...pageObject }
        });
        // console.log('indexed into ES', indexResult);
    }
    catch (error) {
        console.log('error while indexing', error);
    }
    return pageObject; // chain the object for easy usage
}



async function createIndex(client) {
    // create index with mapping
    // return indexname
    function formatDate(date) {
        return [
            date.getFullYear(),
            date.getMonth(),
            date.getDay(),
            date.getHours(),
            date.getMinutes()
        ]
            .map(s => ('' + s).padStart(2, '0'))
            .join('');
    }

    const indexName = `webpages-${formatDate(new Date())}`;

    // for debugging elasticsearch error responses
    // client.on('response', (err, result) => {
    //     console.log(err, result)
    // })


    console.log(`Creating index... ${indexName}`);
    await client.indices.create({
        index: indexName,
        body: {
            settings: {
                index: {
                    number_of_shards: 2,
                    number_of_replicas: 0 // for local development
                },
                analysis: {
                    analyzer: {
                        htmlstrip_analyzer: {
                            tokenizer: 'standard',
                            char_filter: ['html_strip'],
                            filter: ['lowercase', 'asciifolding']
                        }
                    }
                },
            },
            mappings: {
                properties: {
                    content: {
                        type: 'text',
                        analyzer: 'htmlstrip_analyzer'
                    },
                    title: { type: 'text' },
                    url: { type: 'keyword', },
                    crawled_at: { type: 'date' },
                    outbound_urls: { type: 'keyword', },
                }
            }
        }
    });

    console.log(`Done preparing new ES index: ${indexName}`);

    return indexName;
}