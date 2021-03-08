const chalk = require('chalk');
const figlet = require('figlet');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { Client } = require('@elastic/elasticsearch')
const normalizeUrl = require('normalize-url');
const Rx = require('rxjs');
const RxOp = require('rxjs/operators');


console.log(chalk.yellow(figlet.textSync('Web Crawler', { horizontalLayout: 'full' })));

const argv = require('minimist')(process.argv.slice(2));

if (argv.url === undefined) {
    console.error('Usage: `npm run crawler -- --url={site-base-url}`');
    process.exit(1);
}

mainAsync();

async function mainAsync() {
    const client = new Client({ node: 'http://localhost:9200' })

    const url = cleanUrl(argv.url, { forceHttps: true});
    const baseUrl = url; // starting point, we do not escape from this domain

    console.log(`Going to crawl root site ${url}...`);
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0

    const { indexName } = await createIndex(client);
    const seenUrls = [];

    const browser = await puppeteer.launch()
    
    let domain_title;
    const domain_url = baseUrl;

    const queue = new Rx.Subject();
    queue.pipe(
        RxOp.map((url) => cleanUrl(url)),
        // RxOp.tap((url) => {
        //     console.log(`next url [alreadyseen=${!!seenUrls.find(seenUrl => seenUrl === url)}]: ${url}`);
        // }),
        RxOp.filter((url) => !seenUrls.find(seenUrl => seenUrl === url)),
        RxOp.concatMap((url) => fetchAndParsePage(browser, url)),
        RxOp.filter((parsedPageObject) => parsedPageObject !== undefined),
        RxOp.tap((parsedPageObject) => {
            if (domain_title === undefined){
                domain_title = parsedPageObject.title
            }
        }),
        RxOp.map((parsedPageObject) => ({ domain_url, domain_title, ...parsedPageObject})),
        RxOp.mergeMap((parsedPageObject) => index(client ,indexName, parsedPageObject)),
        RxOp.tap((result) => {
            seenUrls.push(result.url);
            //console.log(`urls found on ${result.url}: ${result.outbound_urls}`)
            // only go deeper with our crawl on the same domain
            result.outbound_urls
                .filter(u => u.startsWith(baseUrl))
                .forEach(u => queue.next(u));
        })
    )
    .subscribe(
        (result) => console.log(`[${seenUrls.length}] Downloaded and indexed new url: ${result.url}`),
        (err) => console.error('Error happened: ' + err.message)
    );

    // initiate first request into our queue
    queue.next(url);
}

function cleanUrl(url) {
    // console.log('going to clean url: ', url);
    //let baseUrl = normalizeUrl(argv.url, { forceHttps: true});

    let baseUrl = url.toLowerCase();

    // for static pages the query param is irrelevant
    // const indexOf = baseUrl.indexOf('?');
    // if (indexOf > -1) {
    //     baseUrl = baseUrl.substr(0, indexOf);
    //     console.log('removed ? part: ', baseUrl);
    // }
    

    // for gitbook-like pages some navigations happen with #anchors in the url
    // but we sometimes also see multiple anchors, remove those
    const firstAnchor = baseUrl.indexOf('#');
    if (firstAnchor > -1) {
        const secondAnchor = baseUrl.indexOf('#', firstAnchor+1);
        if (secondAnchor > -1){
            baseUrl = baseUrl.substr(0, secondAnchor);
        }
    }

    return baseUrl;
}



async function fetchAndParsePage(browser, url) {
    try {
        const page = await browser.newPage();
        const response = await page.goto(url, { timeout: 5 * 1000});
        if (!response.ok()) {
            console.log(`Fetching ${url} resulted status ${response.status()}:${response.statusText()}`);
            return undefined;
        }
        const html = await page.content();
        return await parsePageContents(html, url);
    }
    catch (err) {
        console.log(`Error while retrieving page: ${err.message}`);
        return undefined;
    }
}

// take the page contents and extract any follow up urls to crawl
async function parsePageContents(html, url) {
    const urls = [];

    const $ = cheerio.load(html);

    $('a').each((i, link) => {
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
        content: $('body').html(),
        title: $('title').text(),
        url: url,
        crawled_at: new Date().toISOString(),
        outbound_urls: urls
            .map(u => cleanUrl(u))
            .filter(onlyUnique), //dedupe and normalize
    };
    return parsed;
}

// source from https://stackoverflow.com/a/14438954/106909
function onlyUnique(value, index, self) {
    return self.indexOf(value) === index;
}

// index the given page object to our search engine
async function index(client, indexName, pageObject) {
    //console.log('going to index', pageObject.url);
    try {
        const indexResult = await client.index({
            index: indexName,
            body: { ...pageObject }
        });
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
            1 + date.getMonth(), // zero based
            date.getDate(),
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

    try{
        await client.indices.delete({
            index: indexName
        });
    }
    catch(err) {}

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
                            filter: [
                                'lowercase', //all lowercase
                                'asciifolding', // convert diacritcs to base letter
                                'stop', // remove stopwords (the,and,a,..)
                                'stemmer' // default to base root of words
                            ]
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
                    domain_title: { type: 'text' },
                    domain_url: { type: 'keyword' },
                    crawled_at: { type: 'date' },
                    outbound_urls: { type: 'keyword', },
                }
            }
        }
    });

    await client
        .indices
        .putAlias({ index: indexName, name: 'webpages' });

    console.log(`Done preparing new ES index: ${indexName}`);

    return { 
        indexName, 
        alias: 'webpages' 
    };
}