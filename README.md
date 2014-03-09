diskcheck
=========

Tool for checking the CRC values of a folder against the CRC values stored in the filenames or in a mongodb backend.  It looks for CRCs in filenames in the form of "My File [012345678].ext", commonly used in online file distribution.

Requires Mongodb installed and running (On Ubuntu: sudo apt-get install mongodb)

To use, edit the top of diskcheck.js to specify the folder to scan, and the mongodb table to use as a back-end.

To check files, run
```
node . --check
```
This will check the files in the specified folder, log the CRCs of any new files to mongodb.  Absolutely no changes to the filesystem will be made, other than indirectly to the mongodb database if there are new files.

If there are mismatches between this run and a previous run, you can update the database with the new on-disk CRC values by reviewing results.txt and then running
```
node . --fix
```
