
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
