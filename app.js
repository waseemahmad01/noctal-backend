const express = require('express');
const { Storage } = require('@google-cloud/storage');
const { PubSub } = require('@google-cloud/pubsub');
const socketIo = require('socket.io');
const http = require('http');
const cors = require('cors');
const path = require('path');

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

const port = 3002;

const subscriptionName =
  'projects/rugged-alloy-422301-i9/subscriptions/video-exported-upload-sub';

const extractedEventUpload =
  'projects/rugged-alloy-422301-i9/subscriptions/extracted-event-upload-sub';
const soundMatchedUpload =
  'projects/rugged-alloy-422301-i9/subscriptions/sound-matched-upload-sub';

const storage = new Storage({
  keyFilename: path.join(__dirname, '/service_account_keyfile.json'),
  projectId: 'rugged-alloy-422301-i9',
});

const pubsub = new PubSub({
  keyFilename: path.join(__dirname, '/service_account_keyfile.json'),
  projectId: 'rugged-alloy-422301-i9',
});

const bucketName = 'sound-matched-events';
const foleyLibraryBucket = 'foley-sound-library';
const alternateFoleyLibraryBucketName = 'demo-sounds';
const fileName = '1917 manual_events_manual_sounds.json';
const foleyVideoUploads = 'auto-foley-video-uploads';
const soundMatchEvents = 'sound-matched-events';
const foleySoundLarge = 'foley-sound-library-large';
// for test purpose
const bucket = storage.bucket(foleyVideoUploads);

const upload = multer({
  storage: multer.memoryStorage(),
});

const subscription = pubsub.subscription(subscriptionName);

const extractedEventUploadSub = pubsub.subscription(extractedEventUpload);
const soundMatchedUploadSub = pubsub.subscription(soundMatchedUpload);

const broadcastMessage = message => {
  io.emit('message', message);
};

const messageHandler = message => {
  console.log(`Received message: ${message.data.toString()}`);
  const data = JSON.parse(message.data.toString());

  // Broadcast the message to all connected clients
  // broadcastMessage(data);

  // Acknowledge the message
  message.ack();
};

subscription.on('message', message => {
  console.log(`Finalized video`);

  broadcastMessage('Finalized video');

  message.ack();
});
extractedEventUploadSub.on('message', message => {
  console.log(`Extracted video`);

  broadcastMessage('Extracted video');

  message.ack();
});

soundMatchedUploadSub.on('message', message => {
  console.log(`Sound Matched video`);

  broadcastMessage('Sound Matched video');

  message.ack();
});

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
  var file = storage.bucket(foleyLibraryBucket).file(filename);
  var [exists] = await file.exists();
  if (!exists) {
    file = storage.bucket(alternateFoleyLibraryBucketName).file(filename);
    [exists] = await file.exists();
    if (!exists) {
      file = storage.bucket(foleySoundLarge).file(filename);
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

io.on('connection', socket => {
  console.log('Client connected');

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
