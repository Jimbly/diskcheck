/*jslint vars:true, nomen:true, indent:2, plusplus:true, unparam:true, stupid:true, esversion:6 */
"use strict";
var monk = require('monk');
var MultiTask = require('./multi_task.js');

var COLLECTION = 'diskcheck';

// var COLLECTION = 'test';
// var FOLDER = '/var/data/smb_stuff/Video/Anime/Promos/';

var db = monk('localhost/diskcheck');
var files = db.get(COLLECTION);

var mt = new MultiTask(function (err) {
  if (err) {
    throw err;
  }
  db.close();
  console.log('done');
});

files.find({}).each(function (doc) {
  let old_path = '' + doc._id;
  if (old_path.indexOf('/Incoming3/') !== -1) {
    console.log(old_path);
    files.remove({ _id: old_path }, mt.dispatch());
  }
}).then(mt.dispatch());

mt.dispatchDone();