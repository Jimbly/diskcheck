/*jslint vars:true, nomen:true, indent:2, plusplus:true, unparam:true */
"use strict";
var crc32 = require('./crc32.js');
var clc = require('cli-color');
var fs = require('fs');
var path = require('path');
var monk = require('monk');
var linestream = require('line-stream');
var util = require('util');
var MultiTask = require('./multi_task.js');

var MINSCANTIME = 0; // Do not re-check any files which have been checked - for debugging
//var MINSCANTIME = Infinity; // Always recheck every file

var COLLECTION = 'diskcheck';
var FOLDER = '/var/data/diskcheck';

// var COLLECTION = 'test';
// var FOLDER = '/var/data/smb_private/CD Images/';

// var COLLECTION = 'test';
// var FOLDER = '/var/data/smb_stuff/Anime/Promos/';

var ArgumentParser = require('argparse').ArgumentParser;
var parser = new ArgumentParser({
  version: '0.0.1',
  addHelp: true,
  description: 'diskcheck'
});
parser.addArgument([ '-c', '--check' ], { help: 'Run check', action: 'storeTrue'});
parser.addArgument([ '-f', '--fix' ], { help: 'Fix mismatches', action: 'storeTrue'});
var args = parser.parseArgs();
if ((args.check && args.fix) || (!args.check && !args.fix)) {
  console.log('Expected exactly one of --check or --fix');
  process.exit();
}

var db = monk('localhost/diskcheck');
var files = db.get(COLLECTION);

function cleanup() {
  console.log('Cleaning up...');
  db.close();
}

// files.insert({ _id: 'foo.txt', crc: '12345678' }, function (err, doc) {
//   if (err) throw err;
// });
// files.findById('foo.txt', function (err, doc){
//     console.log(doc);
// });

// cb(relpath, stat, next)
function walkDir(base, dir, cb, dir_next) {
  fs.readdir(path.join(base, dir), function (err, files) {
    if (err) {
      throw err;
    }
    var idx = 0;
    function next() {
      if (idx === files.length) {
        return dir_next();
      }
      var filename = files[idx];
      ++idx;
      fs.stat(path.join(base, dir, filename), function (err, stat) {
        if (err) {
          throw err;
        }
        var sub_relpath = path.join(dir, filename);
        if (stat.isDirectory()) {
          walkDir(base, sub_relpath, cb, next);
        } else if (stat.isFile()) {
          cb(sub_relpath, stat, next);
        } else {
          console.log(filename);
          console.log(util.inspect(stat));
          throw "Unknown file type";
        }
      });
    }
    next();
  });
}

function formatCRC(crc) {
  if (crc < 0) {
    crc += 4294967296;
  }
  crc = crc.toString(16);
  while (crc.length < 8) {
    crc = '0' + crc;
  }
  return crc;
}

var crc_regex1 = /\[([0-9a-f]{8})\]/;
var crc_regex2 = /\[([0-9A-F]{8})\]/;
// next(crc || undefined, source)
function crcFromFilename(filename, next) {
  var m = filename.match(crc_regex1);
  if (m) {
    return next(m[1].toLowerCase(), 'filename');
  }
  m = filename.match(crc_regex2);
  if (m) {
    return next(m[1].toLowerCase(), 'filename');
  }
  files.findById(filename, function (err, doc) {
    if (err) {
      throw err;
    }
    if (doc && doc.crc32) {
      return next(doc.crc32, 'database');
    }
    next();
  });
}

function pad2(str) {
  return ('0' + str).slice(-2);
}

function formatBytes(bytes) {
  if (bytes === 1) {
    return '1 byte';
  }
  if (bytes < 1024) {
    return bytes.toFixed(0) + ' bytes';
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(2) + ' kb';
  }
  if (bytes < 1024 * 1024 * 1024) {
    return (bytes / 1024 / 1024).toFixed(2) + ' mb';
  }
  if (bytes < 1024 * 1024 * 1024 * 1024) {
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' gb';
  }
  return (bytes / 1024 / 1024 / 1024 / 1024).toFixed(2) + ' tb';
}

function shouldCheckFile(filename, cb) {
  if (MINSCANTIME > Date.now()) {
    return cb(true);
  }
  files.findById(filename, function (err, doc) {
    if (!err && doc && doc.crc32 && doc.scantime > MINSCANTIME) {
      return cb(false);
    }
    cb(true);
  });
}

function replace(filename, crc32, scantime, next) {
  files.updateById(filename, { crc32: crc32, scantime: scantime }, function (err, code) {
    if (!err && code === 1) {
      // success
      return next();
    }
    if (err) { throw err; }
    // Else probably did not exist, do an insert
    files.insert({ _id: filename, crc32: crc32, scantime: scantime }, function (err) {
      if (err) { throw err; }
      next();
    });
  });
}

function doCheck(next) {
  var scantime = Date.now();
  var last_print_time = Date.now();
  var count = 0;
  var count_since_print = 0;
  var errors = 0;
  var bytes_read = 0;
  var results = fs.createWriteStream('results.txt');
  results.write('# Scan start: ' + scantime + ' (' + new Date(scantime).toLocaleString() + ')');
  results.write('# Mismatches logged below\n');
  results.write('# First character command of i=ignore d=update database\n');
  results.write('# disk_crc expected source   path\n');

  walkDir(FOLDER, '/', function (relpath, stat, next) {
    ++count;
    ++count_since_print;
    var now = Date.now();
    if ((now - last_print_time) > 30000 || count_since_print > 15) {
      var dt = now - scantime;
      var bps = bytes_read * 1000 / dt;
      count_since_print = 0;
      last_print_time = now;
      console.log(clc.cyan('Checked ' + count + ' files, found '
        + (errors ? clc.yellowBright(errors) : errors)
        + ' error' + (errors === 1 ? '' : 's')
        + ', ' + formatBytes(bytes_read) + ', ' + formatBytes(bps) + '/s'
      ));
    }
    process.stdout.write('\r' + relpath);
    shouldCheckFile(relpath, function (should_check) {
      if (!should_check) {
        console.log('\r' + relpath + clc.blackBright(' -- skipping'));
        return next();
      }
      bytes_read += stat.size;
      crc32.crcFile(path.join(FOLDER, relpath), function (err, crc) {
        if (err) { throw err; }
        crc = formatCRC(crc);
        var line = '\r' + relpath + clc.blackBright(' -- CRC:' + crc);
        process.stdout.write(line);
        crcFromFilename(relpath, function (expected_crc, source) {
          if (!expected_crc) {
            console.log(line + clc.blue('  Inserting CRC into database'));
            replace(relpath, crc, scantime, next);
            return;
          }
          if (expected_crc === crc) {
            // Update database with scan time
            console.log(line + clc.blue('  Matches'));
            replace(relpath, crc, scantime, next);
            return;
          }
          console.log(line + clc.redBright('  CRC Mismatch, expected ' + expected_crc +
            ' from ' + source));
          errors++;
          results.write('d ' + crc + ' ' + expected_crc + ' ' + source + ' ' + relpath + '\n');
          next();
        });
      });
    });
  }, function () {
    var dt = Date.now() - scantime;
    var bps = bytes_read * 1000 / dt;
    console.log(clc.cyanBright('Done checking, ' + errors + ' errors'
      + ', took ' + Math.floor(dt / 1000 / 60) + ':' + pad2(Math.floor(dt / 1000))
      + ', ' + formatBytes(bytes_read) + ', ' + formatBytes(bps) + '/s'
    ));
    results.write('# Scan finish: ' + Date.now() + ' (' + new Date().toLocaleString() + ')');
    results.close();
    next();
  });
}

function doFix(next) {
  var s = linestream();
  var comment_regex = /^\w*#/;

  var mt = new MultiTask(next);

  var scantime = Date.now(); // TODO: grab from results.txt?
  s.on('data', function (line) {
    if (line.match(comment_regex)) {
      return;
    }
    var split = line.split(' ');
    if (split[0] === 'i') {
      return;
    }
    if (split[0] === 'd') {
      var disk_crc = split[1];
      var source = split[3];
      var filename = split.slice(4).join(' ');
      if (source === 'filename') {
        console.log(clc.red('Cannot update CRC from filename for "' + filename + '" disk crc=' + disk_crc));
        return;
      }
      console.log(clc.blue('Updating "' + filename + '" to ' + disk_crc));
      mt.dispatch();
      files.updateById(filename, { crc32: disk_crc, scantime: scantime }, function (err, doc) {
        if (err) { throw err; }
        console.log(clc.blueBright('Updated "' + filename + '" to ' + disk_crc));
        mt.done();
      });
    }
  });
  s.on('end', function () {
    mt.dispatchDone();
  });

  fs.createReadStream('results.txt').pipe(s);
}

if (args.check) {
  doCheck(function () {
    cleanup();
  });
} else if (args.fix) {
  doFix(function () {
    cleanup();
  });
}
