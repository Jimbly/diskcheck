/*jslint vars:true, nomen:true, indent:2, plusplus:true, unparam:true, stupid:true, esversion:6 */
"use strict";
var fs = require('fs');
var monk = require('monk');
var MultiTask = require('./multi_task.js');
var path = require('path');

var COLLECTION = 'diskcheck';
var FOLDER = '/var/data/diskcheck';

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

let moved_folders = {
  'Anime': true,
  'BDs': true,
  'DVDs': true,
  'Movies': true,
};
  
files.find({}).each(function (doc) {
  let old_path = '' + doc._id;
  let m = old_path.match(/^\/smb_stuff\/([^/]+)\/(.*)$/);
  if (!m) {
    return;
  }
  if (!moved_folders[m[1]]) {
    return;
  }
  if (fs.existsSync(path.join(FOLDER, old_path))) {
    // Not actually moved
    return;
  }
  let new_path = '/smb_stuff/Video/' + m[1] + '/' + m[2];
  if (fs.existsSync(path.join(FOLDER, new_path))) {
    console.log(old_path + ' -> ' + new_path);
    files.insert({ _id: new_path, crc32: doc.crc32, scantime: doc.scantime }, mt.dispatch());
    files.remove({ _id: old_path }, mt.dispatch());
  }
}).then(mt.dispatch());

mt.dispatchDone();