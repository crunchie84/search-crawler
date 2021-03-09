const path = require('path');
var urlLib=require('url');

const chalk = require('chalk');
const figlet = require('figlet');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { Client } = require('@elastic/elasticsearch')
const Rx = require('rxjs');
const RxOp = require('rxjs/operators');


console.log(chalk.yellow(figlet.textSync('Web Crawler', { horizontalLayout: 'full' })));

const argv = require('minimist')(process.argv.slice(2));

if (argv.recreateindex === undefined && argv.url === undefined && argv.index === undefined) {
    console.error('Usage: `npm run crawler -- --index={indexname} --url={site-base-url}`');
    console.error('Usage: `npm run crawler -- --recreateindex=true` To only create a fresh index to start using' );
    console.error('Hint: You can dump debug information using `kill -s SIGUSR2 {pid}` to this nodejs process');
    process.exit(1);
}

mainAsync();

async function mainAsync() {
    const client = new Client({ node: 'http://localhost:9200' })
    if (argv.recreateindex !== undefined) {
        const {indexName} = await createIndex(client);
        console.log(`new created index=${indexName}`);
        return process.exit();
    }

    const isDebugMode = argv.debug!== undefined;

    const url = cleanUrl(argv.url, { forceHttps: true});
    const baseUrl = url; // starting point, we do not escape from this domain

    console.log(`Going to crawl root site ${url}...`);
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0

    const indexName = argv.index;
    const seenUrls = [];
    
    const browser = await getBrowser(argv.attachtorunningchrome !== undefined);
    let domain_title;
    const domain_url = baseUrl;

    process.on('SIGUSR2', function onDumpDiagnosticsInfo() {
        console.log('recieved SIGUSR2 signal');
        console.log('seen urls: ', seenUrls);
    });

    const isSeenUrlFnc = (url) => seenUrls.find(seenUrl => seenUrl === url);
    const addToSeenUrlsFnc = (url) => seenUrls.push(url);
    const logToDebugFnc = (log) => { 
        if (!isDebugMode) return;
        console.log(log);
    }

    const queue = new Rx.Subject();
    queue.pipe(
        RxOp.concatMap(({url, origin }) => fetchAndParsePage(browser, url, origin, isSeenUrlFnc, addToSeenUrlsFnc, logToDebugFnc)),
        RxOp.filter((parsedPageObject) => parsedPageObject !== undefined),
        RxOp.tap((parsedPageObject) => {
            if (domain_title === undefined){
                domain_title = parsedPageObject.title
            }
        }),
        RxOp.map((parsedPageObject) => ({ domain_url, domain_title, ...parsedPageObject})),
        RxOp.mergeMap((parsedPageObject) => index(client ,indexName, parsedPageObject, logToDebugFnc)),
        RxOp.tap((parsedPageObject) => {
            seenUrls.push(parsedPageObject.url);
            //logToDebugFnc(`urls found on ${parsedPageObject.url}: ${parsedPageObject.outbound_urls}`);
            // only go deeper with our crawl on the same domain
            parsedPageObject.outbound_urls
                .filter(u => u.startsWith(baseUrl)) // stay on the same base url
                .filter(u => !seenUrls.find(seenUrl => seenUrl === u)) // do not enqueue urls we have already visited
                .forEach(u => queue.next({ url: u, origin: parsedPageObject.url})); // enqueue next url to retrieve
        })
    )
    .subscribe(
        (result) => console.log(`[${seenUrls.length}] Downloaded and indexed new url: ${result.url}`),
        (err) => console.error('Error happened: ' + err.message)
    );

    // initiate first request into our queue
    queue.next({ url: url, origin: undefined});
}

async function getBrowser(doAttachToRunningInstance) {
    if (doAttachToRunningInstance) {
        console.log("going to attach to running chrome instead of sandboxed puppeteer sesssion...");
        const browserURL = 'http://127.0.0.1:21222';
        return await puppeteer.connect({browserURL});
    }
    // sandboxed new puppeteer instance, will not be able to leverage existing credentials in your browser
    return await puppeteer.launch();
}

function cleanUrl(url) {
    // remove any relative paths in the url
    const parsed = new URL(url);
    parsed.search ='';
    let baseUrl = parsed.href;

    // remove trailing # if that is the only part there
    if (baseUrl.slice(-1) === '#') {
        baseUrl = baseUrl.substr(0, baseUrl.lastIndexOf('#')); //remove last char # because that makes no sense
    }

    // for gitbook-like pages some navigations happen with #anchors in the url
    // but we sometimes also see multiple anchors, remove those
    const firstAnchor = baseUrl.indexOf('#');
    if (firstAnchor > -1) {
        const secondAnchor = baseUrl.indexOf('#', firstAnchor+1);
        if (secondAnchor > -1){
            baseUrl = baseUrl.substr(0, secondAnchor);
        }
    }

    // keep urls with #/ in it (+md_pages) for gitbooks
    // loose urls with # in it for non-gitbooks, we are not indexing anchors
    if (baseUrl.indexOf('#') > -1){
        if(!baseUrl.includes('md_pages')) {
            //regular anchor, chop it we are not indexing those
            return baseUrl.substr(0, baseUrl.indexOf('#'));
        }
    }
    return baseUrl;
}

async function fetchAndParsePage(browser, url, originUrl, isSeenUrlFnc, addToSeenUrlsFnc, logToDebugFnc) {
    url = cleanUrl(url);
    if (isSeenUrlFnc(url)){
        return undefined;
    }

    logToDebugFnc(`processing url ${url} (origin=${originUrl}`);
    try {
        const page = await browser.newPage();
        const response = await page.goto(url, { timeout: 5 * 1000});
        if (!response.ok()) {
            console.log(`Fetching ${url} resulted status ${response.status()}:${response.statusText()}`);
            console.log(response.headers());
            addToSeenUrlsFnc(url);// we do not want to keep indexing this url which fails
            return undefined;
        }
        const html = await page.content();
        await page.close(); //close it up
        return await parsePageContents(html, url);
    }
    catch (err) {
        console.log(`Error while retrieving page: ${err.message}`);
        addToSeenUrlsFnc(url);// we do not want to keep indexing this url which fails
        return undefined;
    }
}

// take the page contents and extract any follow up urls to crawl
async function parsePageContents(html, url) {
    const urls = [];
    const $ = cheerio.load(html, { decodeEntities: false });

    // if we end in a static file known extension then remove it up until the last slash
    let baseUrlForLinks = url;
    if (url.includes('.md') || url.includes('.htm')) {
        baseUrlForLinks = url.substr(0, 1 + url.lastIndexOf('/'));// remove any filenames if they are there
    }
    $('a').each((i, link) => {
        const href = $(link).attr('href');

        if(!href || href === '#' || href.includes('##')) {
            return;//no url in there or mallformed
        }

        if (href.startsWith('http')){
            return urls.push(href);
        }

        // anchors vs gitbook links
        // anchors are looking like #this-is-an-anchor
        if (href.startsWith('#')) {
            if (href.startsWith('#/')) {
                // gitbook looks liks #/md_pages/here-be-a-page
                return urls.push(baseUrlForLinks + href);
            }
            return; // this is a local anchor on this page to an id=#foo, skip it
        }

        if ($(link).attr('data-nosearch') !== undefined){
            return;//do not further index these magical gitbook links
        }

        if (href.indexOf(':') !== -1){
            return; //not going to handle other protocols like mailto:foo@bar.baz
        }

        // this is a local path switch denotion, we need to get rid of the # on the url to make it sensib;e
        if (href.startsWith('.') && url.includes('#')) {
            const baseUrl = url.substr(0, url.indexOf('#'));
            if (baseUrl.slice(-1) !== '/') {
                return urls.push(baseUrl + '/' + href);
            }
            return urls.push(baseUrl + href);
        }


        // if the href starts with an # its an anchor, no need to add / before it then
        if (href.startsWith('#') || baseUrlForLinks.slice(-1) === '#') {
            return urls.push(baseUrlForLinks + href);
        }

        //make sure we glue it together with at least one /
        if(baseUrlForLinks.slice(-1) !== '/' && !href.startsWith('/')) {
            // no / present between the parts, glue it together 
            return urls.push(baseUrlForLinks + '/' + href);
        }

        if (href.startsWith('/')) {
            //path is based on the root of the url
            return urls.push('https://' + urlLib.parse(baseUrlForLinks).hostname + href);
        }

        urls.push(baseUrlForLinks + href);//relative url
    });

    //cleanup the body a lot with non-functionals for text searches
    $('body').find('script').remove();
    $('body').find('svg').remove();
    $('body').find('img').remove();
    $('body').find('button').remove();

    // aside typically contains the menu. There is no extra information in there to index
    $('body').find('aside').remove();
    $('body').find('nav').remove();
    $('body').find('header').remove();

    const content = $('body *').contents().map(function(){ 
        return (this.type === 'text') ? $(this).text()+' ' : '';
    }).get()
        .join('')
        .replace(/(\r\n|\r|\n){2,}/g, '$1\n') // clean up multiple newlines
        .replace(/\s+/g, ' ') // clean up multiples spaces
        .trim(); // clean up begin/end of string

    if(url.includes('md_pages') && content.includes('Page not Found (404)')){
        return undefined; // non-descriptive 404 page of gitbooks
    }

    if (content == ''){
        console.log('no content found on page!? ', url);
        return undefined;
    }

    const parsed = {
        content: content,
        title: $('title').text(),
        url: url,
        crawled_at: new Date().toISOString(),
        outbound_urls: urls
            .map(u => cleanUrl(u))
            .filter(u => !(u.endsWith('.png') || u.endsWith('.jpg') || u.endsWith('.pdf'))) // no images
            .filter(onlyUnique), //dedupe and normalize
    };
    return parsed;
}

// source from https://stackoverflow.com/a/14438954/106909
function onlyUnique(value, index, self) {
    return self.indexOf(value) === index;
}

// index the given page object to our search engine
async function index(client, indexName, pageObject, logToDebugFnc) {
    logToDebugFnc('going to index', pageObject.url);
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