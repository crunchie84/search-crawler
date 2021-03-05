const express = require('express');
const app = express();
const port = 8080;
const nunjucks = require('nunjucks');

nunjucks.configure('views', {
    autoescape: true,
    express: app
});

app.get('/', (req, res) => {
  res.render('index.html');
});

app.post('/search', (req,res) => {
    //searching for something
    // TODO
    //req field name = 'q'
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
});
