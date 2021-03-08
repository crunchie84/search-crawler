const express = require('express');
const app = express();
const port = 8080;

app.get('/', (req, res) => {
  res.sendFile('./views/index.html', { root: __dirname });
});

app.post('/search', (req,res) => {
    //searching for something
    // TODO
    //req field name = 'q'
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
});
