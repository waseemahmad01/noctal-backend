const express = require('express');
const { Storage } = require('@google-cloud/storage');
const cors = require('cors');
const path = require('path');
const multer = require('multer');

const app = express();
const port = 3002;

const storage = new Storage({
  keyFilename: path.join(__dirname, '/service_account_keyfile.json'),
  projectId: 'rugged-alloy-422301-i9',
});

const bucketName = 'sound-matched-events';
const foleyLibraryBucket = 'foley-sound-library';
const alternateFoleyLibraryBucketName = 'demo-sounds';
const fileName = '1917 manual_events_manual_sounds.json';
const foleyVideoUploads = 'auto-foley-video-uploads';
const soundMatchEvents = 'sound-matched-events';
// for test purpose
const bucket = storage.bucket('front-end-video-upload-test');

const upload = multer({
  storage: multer.memoryStorage(),
});

app.use(cors());
app.use(express.json());

app.get('/api/json-data', async (req, res) => {
  try {
    const file = storage.bucket(bucketName).file(fileName);
    const [contents] = await file.download();
    const jsonData = JSON.parse(contents.toString());
    res.json(jsonData);
  } catch (err) {
    console.error('Error fetching JSON data:', err);
    res.status(500).send('Error fetching JSON data');
  }
});

app.get('/audio/:filename', async (req, res) => {
  res.set('Content-Type', 'audio/wav');
  const filename = req.params.filename;
  var file = storage.bucket(foleyLibraryBucket).file(filename);

  var [exists] = await file.exists();
  if (!exists) {
    file = storage.bucket(alternateFoleyLibraryBucketName).file(filename);
    [exists] = await file.exists();
    if (!exists) {
      return res.status(404).send('File not found');
    }
  }

  const remoteReadStream = file.createReadStream();
  remoteReadStream.on('error', err => {
    res.status(500).send('Error retrieving file');
  });
  remoteReadStream.pipe(res);
});

app.get('/api/projects', async (req, res) => {
  try {
    const [files] = await storage.bucket(soundMatchEvents).getFiles();
    const jsonDataPromises = files.map(async file => {
      const [contents] = await file.download();
      return JSON.parse(contents.toString('utf8'));
    });

    const jsonDataArray = await Promise.all(jsonDataPromises);

    res.json(jsonDataArray);
  } catch (err) {
    res.status(500).send('Error fetching projects');
  }
});

app.get('/api/:videoName/url', async (req, res) => {
  try {
    const videoName = req.params.videoName;
    const [url] = await storage
      .bucket(foleyVideoUploads)
      .file(videoName)
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 2000 * 60 * 60,
      });
    res.json({ url });
  } catch (error) {
    res.status(500).send('Error fetching video');
  }
});

app.post('/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded.');
    }

    const blob = bucket.file(req.file.originalname);
    const blobStream = blob.createWriteStream({
      resumable: false,
    });

    blobStream.on('error', err => {
      res.status(500).send({ message: err.message });
    });

    blobStream.on('finish', () => {
      res.status(200).send('File uploaded.');
    });

    blobStream.end(req.file.buffer);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
