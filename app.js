var FeedParser = require('feedparser');
var request = require('request'); // for fetching the feed
var fs = require('fs');
var ioLib = require('socket.io');
var http = require('http');
var path = require('path');
var express = require('express');
var Promise = require('bluebird');

var port = 8080;

// Create the express app
var app = express();
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', function(req, res) {
  res.render('index', {});
});

// Handle unexpected server errors
app.use(function(err, req, res, next) {
    if (req.xhr) {
        res.status(err.status || 500).send({ error: 'Something failed!' });
        res.render('error', {
            message: err.stack,
            error: err
        });
    } else {
        next(err);
    }
});

var sockets = [];
var server = http.Server(app);
var io = ioLib(server);

// Setup sockets for updating web UI
io.on('connection', function(socket) {

  const fetch = (url) => {
    return new Promise((resolve, reject) => {
      if (!url) { return reject(new Error(`Bad URL (url: ${url}`)); }

      const
        feedparser = new FeedParser(),
        items     = [];

      feedparser.on('error', (e) => {
        return reject(e);
      }).on('readable', () => {
        // This is where the action is!
        var item;

        while (item = feedparser.read()) {
          items.push(item)
        }
      }).on('end', () => {
        resolve({
          meta: feedparser.meta,
          records: items
        });
      });

      request({
        method: 'GET',
        url: url
      }, (e, res, body) => {
        if (e) {
          return reject(e);
        }

        if (res.statusCode != 200) {
          return reject(new Error(`Bad status code (status: ${res.statusCode}, url: ${url})`));
        }

        feedparser.end(body);
      });
    });
  };

  Promise.map([
    'https://os.mbed.com/feeds/questions',
    'https://os.mbed.com/feeds/allforums'
  ], (url) => fetch(url), {concurrency: 4}) // note that concurrency limit
  .then((feeds) => {
    var unsortedList = [];
    feeds.forEach(function(feed) {
      feed.records.forEach(function(item) {
        var entry = {};
        entry.type = (item.link.indexOf("https://os.mbed.com/forum") != -1) ? "forum" : ((item.link.indexOf("#answer") != -1) ? "answer" : "question");
        entry.title = item.title;
        entry.date = Date.parse(item.date);
        var author = item.summary;
        author = author.substring(0,author.indexOf("</a></span>"));
        author = author.substring(author.lastIndexOf(">")+2,author.length);
        entry.author = author;
        var summary = item.summary;
        if (entry.type!="forum") {
          summary = summary.substring(summary.indexOf("</b>"));
          summary = summary.substring(0, summary.indexOf("</p>"));
        } else {
          summary = summary.substring(summary.indexOf("wrote:")+6);
          summary = summary.substring(0, summary.indexOf("<a href"));
        }
        entry.summary = summary.trim();
        entry.link = item.link;
        unsortedList.push(entry);
      });
    });
    unsortedList.sort(function(a, b) {
      return b.date - a.date;
    });
    unsortedList.forEach(function(item) {
      socket.emit("new-entry", item);
    });
  });

  // Add new client to array of client upon connection
  sockets.push(socket);

  socket.on('socket-emit', function(data) {

  });

});

// Start the app
server.listen(port, function() {
  console.log('Site started on http://localhost:%s', port);
});