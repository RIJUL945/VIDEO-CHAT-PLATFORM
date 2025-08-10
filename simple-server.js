const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// In-memory storage for rooms
const rooms = {};

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'simple-index.html'));
});

// Serve your beautiful zoom-style room (copy it as simple-room.html)
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
  
  // Force HTTPS for public domains
  const protocol = req.get('host').includes('localhost') ? req.protocol : 'https';
  
  res.json({
    success: true,
    roomId: roomId,
    inviteLink: `${protocol}://${req.get('host')}/room/${roomId}`,
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
      console.log(`❌ Room ${roomId} not found`);
      // Use 'join-error' instead of 'error' to prevent homepage redirect
      socket.emit('join-error', { message: 'Room not found' });
      return;
    }
    
    const room = rooms[roomId];
    
    if (room.participants.length >= room.maxCapacity) {
      socket.emit('join-error', { message: 'Room is full' });
      return;
    }
    
    // Add user to room
    const participant = {
      socketId: socket.id, // Your UI expects 'socketId', not 'id'
      userName: userName,  // Your UI expects 'userName', not 'name'
      joinedAt: new Date()
    };
    
    room.participants.push(participant);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = userName;
    
    console.log(`${userName} joined room ${roomId}. Total: ${room.participants.length}`);
    
    // Notify user they joined successfully (matching your UI expectations)
    socket.emit('room-joined', {
      roomId: roomId,
      participants: room.participants,
      maxCapacity: room.maxCapacity
    });
    
    // Notify others in room about new participant (matching your UI expectations)
    socket.to(roomId).emit('user-joined', participant);
    
    // Update participant count for everyone (matching your UI expectations)
    io.to(roomId).emit('participant-update', {
      count: room.participants.length,
      maxCapacity: room.maxCapacity,
      participants: room.participants
    });
  });
  
  // Handle user leaving
  socket.on('leave-room', () => {
    if (socket.roomId) {
      const room = rooms[socket.roomId];
      if (room) {
        room.participants = room.participants.filter(p => p.socketId !== socket.id);
        socket.to(socket.roomId).emit('user-left', { socketId: socket.id, userName: socket.userName });
        io.to(socket.roomId).emit('participant-update', {
          count: room.participants.length,
          maxCapacity: room.maxCapacity,
          participants: room.participants
        });
      }
    }
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    if (socket.roomId) {
      const room = rooms[socket.roomId];
      if (room) {
        room.participants = room.participants.filter(p => p.socketId !== socket.id);
        socket.to(socket.roomId).emit('user-left', { socketId: socket.id, userName: socket.userName });
        io.to(socket.roomId).emit('participant-update', {
          count: room.participants.length,
          maxCapacity: room.maxCapacity,
          participants: room.participants
        });
      }
    }
  });
  
  // Chat messages (matching your UI expectations)
  socket.on('chat-message', (data) => {
    const { roomId, message } = data;
    if (socket.roomId === roomId) {
      io.to(roomId).emit('chat-message', {
        userName: socket.userName,
        message: message,
        timestamp: new Date(),
        senderId: socket.id
      });
    }
  });
  
  // WebRTC signaling for video/audio
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
});

server.listen(PORT, () => {
  console.log(`🚀 Video Chat Server running on port ${PORT}`);
});
