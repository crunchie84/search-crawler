const express = require('express');
const app = express();
const port = 8080;
const { Client } = require('@elastic/elasticsearch')

const client = new Client({ node: 'http://localhost:9200' });

app.get('/', (req, res) => {
  res.sendFile('./views/index.html', { root: __dirname });
});

app.post('/search', (req,res) => {
  const query = req.query.q;
    client.search({
      index: 'webpages',
      body: {
        query: {
          match: { content: query }
        },
        highlight: {
          fields: {
            content: {}
          }
        }
      }
    }).then(
        (searchResult) => {
          const hits = searchResult.body.hits.total.value;
          console.log(`Search for "${query}" - returning ${hits} search results`);
          const mapped = searchResult.body.hits.hits.map((hit) => ({
            _id: hit._id,
            _score: hit._score,
            title: hit._source.title,
            url: hit._source.url,
            crawled_at: hit._source.crawled_at,
            _excerpt: hit.highlight.content
          }))
          res.status(200).json(mapped);
        },
        (err) => {
          console.log(`Error while searching for "${query}": ${err.message}`); 
          res.sendStatus(500)
        });
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
});
