const express = require('express');
const { Storage } = require('@google-cloud/storage');
// const { PubSub } = require('@google-cloud/pubsub');
const socketIo = require('socket.io');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['my-custom-header'],
    credentials: true,
  },
});

function generateRandomString(length = 15) {
  const characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let randomString = '';
  for (let i = 0; i < length; i++) {
    randomString += characters.charAt(
      Math.floor(Math.random() * characters.length)
    );
  }
  return randomString;
}

const port = 3002;

// const subscriptionName =
//   'projects/rugged-alloy-422301-i9/subscriptions/video-exported-upload-sub';

// const extractedEventUpload =
//   'projects/rugged-alloy-422301-i9/subscriptions/extracted-event-upload-sub';
// const soundMatchedUpload =
//   'projects/rugged-alloy-422301-i9/subscriptions/sound-matched-upload-sub';

// const videoUpload =
//   'projects/rugged-alloy-422301-i9/subscriptions/video-upload-sub';

const storage = new Storage({
  keyFilename: path.join(__dirname, '/service_account_keyfile.json'),
  projectId: 'rugged-alloy-422301-i9',
});

// const pubsub = new PubSub({
//   keyFilename: path.join(__dirname, '/service_account_keyfile.json'),
//   projectId: 'rugged-alloy-422301-i9',
// });

const bucketName = 'sound-matched-events';
const foleyLibraryBucket = 'foley-sound-library-mp3';
const uploadBucketlink = 'gs://auto-foley-video-uploads/';
const alternateFoleyLibraryBucketName = 'demo-sounds';
const fileName = '1917 manual_events_manual_sounds.json';
const foleyVideoUploads = 'auto-foley-video-uploads';
const soundMatchEvents = 'sound-matched-events';
const foleySoundLarge = 'foley-sound-library-compressed';
// for test purpose
const bucket = storage.bucket(foleyVideoUploads);

const upload = multer({
  storage: multer.memoryStorage(),
});

const broadcastMessage = message => {
  io.emit('message', message);
};

console.log('Listening to pubsub');

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

app.post('/audio', async (req, res) => {
  res.set('Content-Type', 'audio/wav');
  const filename = req.body.filename;
  const name = filename.replace('.wav', '.mp3');
  var file = storage.bucket(foleyLibraryBucket).file(name);
  var [exists] = await file.exists();
  if (!exists) {
    file = storage.bucket(alternateFoleyLibraryBucketName).file(filename);
    [exists] = await file.exists();
    if (!exists) {
      const name = filename.replace('.wav', '.mp3');
      // const name = filename;
      file = storage.bucket(foleySoundLarge).file(name);
      [exists] = await file.exists();
      if (!exists) {
        return res.status(404).send('File not found');
      }
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

    const filename =
      req.file.originalname.substring(
        0,
        req.file.originalname.lastIndexOf('.')
      ) || req.file.originalname;

    let name = filename + '__' + generateRandomString();

    const blob = bucket.file(name);
    const blobStream = blob.createWriteStream({
      resumable: false,
    });

    blobStream.on('error', err => {
      res.status(500).send({ message: err.message });
    });

    blobStream.on('finish', () => {
      res.status(200).json({ url: uploadBucketlink + name });
    });

    blobStream.end(req.file.buffer);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

app.post('/upload-json', async (req, res) => {
  try {
    const { jsonData, name } = req.body;
    fs.writeFileSync(
      `./uploads/${name}.json`,
      JSON.stringify(jsonData, null, 2)
    );
    const data = fs.readFileSync(`./uploads/${name}.json`);

    await storage
      .bucket(bucketName)
      .file(`${name}.json`)
      .save(data, { contentType: 'application/json' });
    fs.unlink(`./uploads/${name}.json`, err => {
      if (err) console.log(err);
    });
    res.status(200).send('JSON data uploaded successfully');
  } catch (error) {
    console.log(error);
    res.status(500).send('Error uploading JSON data');
  }
});

io.on('connection', socket => {
  console.log('Client connected');

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
