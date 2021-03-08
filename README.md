
Web Crawler which can ingest the pages into elasticsearch



## Run elasticsearch locally in a docker container
- `docker run -p 9200:9200 -p 9300:9300 -e "discovery.type=single-node" docker.elastic.co/elasticsearch/elasticsearch:7.11.1`

## Start the crawler
`npm run crawler -- --url={site-base-url}`


Pages are indexed to elasticsearch index 'webpages'
http://localhost:9200/webpages


https://github.com/ReactiveX/rxjs
https://eemp.io/2017/06/18/elasticsearch-html-content/
https://github.com/janl/mustache.js

## send signal to dump debug info

```
# first find the processid
ps -e|grep node
# send signal to the process
kill -s SIGUSR2 {pid}
```

## sites to index

```
npm run crawler -- --index=webpages --url=https://nn-cnc-corporate.docs.aws.insim.biz/gitbook --index=webpages-202103082203

npm run crawler -- --index=webpages --url=https://nn-cnc-corporate.docs.aws.insim.biz/gitbook
npm run crawler -- --index=webpages --url=https://web-components.docs.aws.insim.biz/frontenddevelopment-gettingstarted
npm run crawler -- --index=webpages --url=https://aws-team.docs.aws.insim.biz/aws-platform/
npm run crawler -- --index=webpages --url=https://dockernn.docs.aws.insim.biz/cpt-docs
npm run crawler -- --index=webpages --url=https://startech.docs.aws.insim.biz/api.insim.biz
npm run crawler -- --index=webpages --url=https://nn-cnc-corporate.docs.aws.insim.biz/documentation/portal-documentation


```

needs auth?
```
https://dev.azure.com/cio-innovation-nn-group/Catapult/_wiki/wikis/Catapult.wiki/41/Home
https://nn-engineering.dev/

```
