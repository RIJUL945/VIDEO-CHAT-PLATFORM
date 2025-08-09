const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.json());
app.use(express.static('public'));

// Simple in-memory storage
const rooms = {};

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'simple-index.html'));
});

app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'simple-room.html'));
});

// Create room API
app.post('/create-room', (req, res) => {
  const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  const { ownerName, maxCapacity = 10 } = req.body;
  
  rooms[roomId] = {
    id: roomId,
    owner: ownerName,
    maxCapacity: parseInt(maxCapacity),
    participants: [],
    created: new Date()
  };
  
  console.log(`Room created: ${roomId} by ${ownerName}`);
  
  res.json({
    success: true,
    roomId: roomId,
    inviteLink: `${req.protocol}://${req.get('host')}/room/${roomId}`,
    maxCapacity: maxCapacity
  });
});

// Socket handling
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  socket.on('join-room', (data) => {
    const { roomId, userName } = data;
    console.log(`${userName} trying to join room ${roomId}`);
    
    if (!rooms[roomId]) {
      socket.emit('error', 'Room not found');
      return;
    }
    
    const room = rooms[roomId];
    
    if (room.participants.length >= room.maxCapacity) {
      socket.emit('error', 'Room is full');
      return;
    }
    
    // Add user to room
    const participant = {
      id: socket.id,
      name: userName,
      joinedAt: new Date()
    };
    
    room.participants.push(participant);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = userName;
    
    console.log(`${userName} joined room ${roomId}. Total: ${room.participants.length}`);
    
    // Notify user they joined successfully
    socket.emit('joined-room', {
      roomId: roomId,
      participants: room.participants,
      maxCapacity: room.maxCapacity
    });
    
    // Notify others in room
    socket.to(roomId).emit('user-joined', participant);
    
    // Update participant count for everyone
    io.to(roomId).emit('participant-update', {
      count: room.participants.length,
      maxCapacity: room.maxCapacity,
      participants: room.participants
    });
  });
  
  // Handle chat messages
  socket.on('send-message', (data) => {
    const { roomId, message } = data;
    if (socket.roomId === roomId) {
      io.to(roomId).emit('new-message', {
        userName: socket.userName,
        message: message,
        timestamp: new Date(),
        senderId: socket.id
      });
      console.log(`Message in ${roomId} from ${socket.userName}: ${message}`);
    }
  });
  
  // Handle WebRTC signaling
  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id,
      senderName: socket.userName
    });
  });
  
  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });
  
  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    if (socket.roomId && rooms[socket.roomId]) {
      const room = rooms[socket.roomId];
      room.participants = room.participants.filter(p => p.id !== socket.id);
      
      console.log(`${socket.userName} left room ${socket.roomId}. Remaining: ${room.participants.length}`);
      
      // Notify others
      socket.to(socket.roomId).emit('user-left', {
        userId: socket.id,
        userName: socket.userName
      });
      
      // Update participant count
      io.to(socket.roomId).emit('participant-update', {
        count: room.participants.length,
        maxCapacity: room.maxCapacity,
        participants: room.participants
      });
      
      // Delete empty rooms
      if (room.participants.length === 0) {
        delete rooms[socket.roomId];
        console.log(`Room ${socket.roomId} deleted - empty`);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎉 SIMPLE CHAT PLATFORM RUNNING ON PORT ${PORT}`);
  console.log(`📱 Access at: http://localhost:${PORT}`);
  console.log(`🚀 Ready to create rooms and chat!\n`);
});
