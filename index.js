/*jslint vars:true, nomen:true, indent:2, plusplus:true, unparam:true, stupid:true, esversion:6, noempty:false */
const crc32 = require('./crc32.js');
const clc = require('cli-color');
const fs = require('fs');
const path = require('path');
const monk = require('monk');
const linestream = require('line-stream');
const util = require('util');
const MultiTask = require('./multi_task.js');

//const MINSCANTIME = 0; // Do not re-check any files which have been checked - for debugging
const MINSCANTIME = Infinity; // Always recheck every file / start a new scan
//const MINSCANTIME = 1580393626818; // continue from where scan left off - use the date the last scan was STARTED

const COLLECTION = 'diskcheck';
const FOLDER = '/var/data/diskcheck';

// const COLLECTION = 'test';
// const FOLDER = '/var/data/smb_private/CD Images/';

// const COLLECTION = 'test';
// const FOLDER = '/var/data/smb_stuff/Video/Anime/Promos/';

const skip_paths_arr = [
  '/smb_private/backup/dashingstrike',
  '/smb_private/etc/apache2/ssl', // no access
  '/smb_private/nobackup/temp',
  '/smb_private/backup/nobackup',
//  '/smb_private/work', // checking this because node binaries live here for now
];
let skip_paths = Object.create(null);
skip_paths_arr.forEach((fn) => (skip_paths[fn] = true));

let ArgumentParser = require('argparse').ArgumentParser;
let parser = new ArgumentParser({
  version: '0.0.1',
  addHelp: true,
  description: 'diskcheck'
});
parser.addArgument([ '-c', '--check' ], { help: 'Run check', action: 'storeTrue'});
parser.addArgument([ '-s', '--subdir' ], { help: 'Check specific subdir with -c' });
parser.addArgument([ '-m', '--missing' ], { help: 'After -c, and setting MINSCANTIME,' +
  ' run check for missing (or now skipped) files', action: 'storeTrue'});
parser.addArgument([ '-f', '--fix' ], { help: 'Fix mismatches', action: 'storeTrue'});
let args = parser.parseArgs();
if ((args.check?1:0) + (args.fix?1:0) + (args.missing?1:0) !== 1) {
  console.log('Expected exactly one of --check or --fix or --missing');
  process.exit();
}

let db = monk('localhost/diskcheck');
let files = db.get(COLLECTION);

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

let crc_regex1 = /\[([0-9a-f]{8})\]/;
let crc_regex2 = /\[([0-9A-F]{8})\]/;
// next(crc || undefined, source)
function crcFromFilename(filename, next) {
  // These file suffixes indicate a bad file, allow the database to be used for a clean "check"
  if (filename.indexOf('_CRCMISMATCH.') === -1 && filename.indexOf('_CORRUPT.') === -1 &&
    filename.slice(-4) !== '.lnk' && filename.slice(-4) !== '.srt'
  ) {
    let m = filename.match(crc_regex1);
    if (m) {
      return next(m[1].toLowerCase(), 'filename');
    }
    m = filename.match(crc_regex2);
    if (m) {
      return next(m[1].toLowerCase(), 'filename');
    }
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

function openResults(scantime) {
  if (fs.existsSync('results.txt')) {
    if (fs.existsSync('results.txt.1')) {
      if (fs.existsSync('results.txt.2')) {
        fs.unlinkSync('results.txt.2');
      }
      fs.renameSync('results.txt.1', 'results.txt.2');
    }
    fs.renameSync('results.txt', 'results.txt.1');
  }
  var results = fs.createWriteStream('results.txt');
  results.write('# Scan start: ' + scantime + ' (' + new Date(scantime).toLocaleString() + ')\n');
  results.write('# Mismatches logged below\n');
  results.write('# First character command of i=ignore d=update database\n');
  results.write('# disk_crc expected source   path\n');
  return results;
}

function closeResults(results) {
  results.write('# Scan finish: ' + Date.now() + ' (' + new Date().toLocaleString() + ')\n');
  results.close();
}

function doCheck(next) {
  var scantime = Date.now();
  var last_print_time = Date.now();
  var count = 0;
  var count_since_print = 0;
  var errors = 0;
  var bytes_read = 0;
  var results = openResults(scantime);

  // cb(relpath, stat, next)
  function walkDir(base, dir, cb, dir_next) {
    fs.readdir(path.join(base, dir), function (err, files) {
      if (err) {
        if (err.code === 'EACCES') {
          // Not a readable file, don't be noisy about it
        } else {
          errors++;
        }
        results.write('# readdir error ' + (err.code || '') + ' ' + path.join(base, dir) + '\n');
        return dir_next();
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
            if (err.code === 'ENOENT') {
              // bad symlink or file removed during scan, skip
              return next();
            } else {
              console.log(err);
              throw err;
            }
          }
          var sub_relpath = path.join(dir, filename);
          if (filename === 'Incoming3' || skip_paths[sub_relpath]) {
            // skip folders named "Incoming3", too much junk
            // Also skip "work" folder, it changes lots of files regularly
            next();
          } else if (stat.isDirectory()) {
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

  let baserel = '/';
  if (args.subdir) {
    baserel = path.join(baserel, args.subdir);
  }
  walkDir(FOLDER, baserel, function (relpath, stat, next) {
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
        if (err) {
          console.log('\r' + relpath + clc.redBright(' -- error reading file: ' + err));
          if (err.code === 'EACCES') {
            // Not a readable file, don't be noisy about it
          } else {
            errors++;
          }
          results.write('# read error ' + (err.code || '') + ' ' + relpath + '\n');
          return next();
        }
        crc = crc32.formatCRC(crc);
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
    closeResults(results);
    next();
  });
}

function doMissingCheck(next) {
  let scantime = Date.now();
  let results = openResults(scantime);
  var mt = new MultiTask(function (err) {
    closeResults(results);
    if (err) {
      throw err;
    }
    next();
  });

  files.find({}).each(function (doc, cursor) {
    let relpath = '' + doc._id;
    if (!doc.crc32 || !doc.scantime || doc.scantime <= MINSCANTIME) {
      // file was not touched in the last --check run
      console.log(relpath + clc.blackBright(' -- missing'));
      results.write('d 0 existing missing ' + relpath + '\n');
    }
  }).then(mt.dispatch());

  mt.dispatchDone();
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
    var op = split[0];
    var disk_crc = split[1];
    var source = split[3];
    var filename = split.slice(4).join(' ');
    if (op === 'i') {
      return;
    }
    if (op === 'd' && source === 'missing') {
      // remove from database
      console.log(clc.blue('Removing "' + filename + '" from database'));
      mt.dispatch();
      files.remove({ _id: filename }, function (err) {
        if (err) {
          return mt.done(err);
        }
        console.log(clc.blueBright('Removed "' + filename + '" from database'));
        mt.done();
      });
      return;
    }
    if (op === 'd') {
      if (source === 'filename' && filename.indexOf('_CORRUPT.') === -1 && filename.indexOf('_CRCMISMATCH.') === -1) {
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
} else if (args.missing) {
  doMissingCheck(function () {
    cleanup();
  });
} else if (args.fix) {
  doFix(function () {
    cleanup();
  });
}
