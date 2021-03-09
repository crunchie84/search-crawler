Web Crawler which can ingest the pages into elasticsearch. Also includes a minimal frontend to render the search results

Some of the used tech:

- https://github.com/ReactiveX/rxjs
- https://eemp.io/2017/06/18/elasticsearch-html-content/
- https://github.com/janl/mustache.js
- https://en.wikipedia.org/wiki/Elbow_grease


## Requirements

- Nodejs
- puppeteer (needs a browser)
- Run elasticsearch locally in a docker container
  - `docker run -p 9200:9200 -p 9300:9300 -e "discovery.type=single-node" docker.elastic.co/elasticsearch/elasticsearch:7.11.1`

## Create the index
- `npm run crawler -- --recreateindex=true`

This will create an index `webpages-YYYYMMDDTHHMM` (for instance=`webpages-20210309T0917`) and add this to the alias `webpages`. The site will search the index `webpages`. If you want to create a new fresh index you can pass the argument `index=webpages-20210309T0917` to the crawler to have it ingest the data in this new index.

## Start the crawler for a site
`npm run crawler -- --url={site-base-url} --index=webpages-xxxxx`

## send signal to dump debug info

```
# first find the processid
ps -e|grep node
# send signal to the process
kill -s SIGUSR2 {pid}
```

## sites to index

```
npm run crawler -- --index=webpages --url=https://nn-cnc-corporate.docs.aws.insim.biz/gitbook
npm run crawler -- --index=webpages --url=https://web-components.docs.aws.insim.biz/frontenddevelopment-gettingstarted
npm run crawler -- --index=webpages --url=https://aws-team.docs.aws.insim.biz/aws-platform/
npm run crawler -- --index=webpages --url=https://dockernn.docs.aws.insim.biz/cpt-docs
npm run crawler -- --index=webpages --url=https://startech.docs.aws.insim.biz/api.insim.biz
npm run crawler -- --index=webpages --url=https://nn-cnc-corporate.docs.aws.insim.biz/documentation/portal-documentation

npm run crawler -- --index=webpages --url=https://nn-cnc-foundation.docs.aws.insim.biz/gitbooks/data-access/



```

## scratchpad

needs auth? need to figure out how
https://dev.to/sonyarianto/puppeteer-quick-tip-how-to-do-basic-authentication-2pe7

```
https://dev.azure.com/cio-innovation-nn-group/Catapult/_wiki/wikis/Catapult.wiki/41/Home
https://nn-engineering.dev/

```

For getting access to authenticated resources we can use a hack
- We run chrome with flags to allow a debugger to attach (`--remote-debugging-port=21222`)
  - https://stackoverflow.com/questions/5018494/how-to-add-launch-parameter-to-google-chrome-on-mac
  - open /Applications/Google\ Chrome.app --args --remote-debugging-port=21222
- Instead of puppeteer opening a sandboxed browser we let it attach to our running browser instance
  - npm run crawler -- --attachtorunningchrome --index=webpages --url=https://nn-engineering.dev/

```
const browserURL = 'http://127.0.0.1:21222';
const browser = await puppeteer.connect({browserURL});
```
