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
      socket.emit('error', 'Room not found');
      return;
    }
    
    const room = rooms[roomId];
    
    if (room.participants.length >= room.maxCapacity) {
      socket.emit('error', 'Room is full');
      return;
    }
    
    // Add participant to room
    const participant = {
      socketId: socket.id,
      userName: userName,
      joinedAt: new Date()
    };
    
    room.participants.push(participant);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = userName;
    
    // Notify existing participants about new user
    socket.to(roomId).emit('user-joined', participant);
    
    // Send current participants to new user
    socket.emit('room-joined', {
      roomId: roomId,
      participants: room.participants,
      maxCapacity: room.maxCapacity
    });
    
    // Update participant count for all
    io.to(roomId).emit('participant-count-update', {
      count: room.participants.length,
      maxCapacity: room.maxCapacity
    });
  });
  
  // WEBRTC SIGNALING EVENTS - THESE ARE THE MISSING PIECES!
  socket.on('offer', (data) => {
    console.log(`WebRTC offer from ${socket.id} to ${data.target}`);
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id,
      senderName: socket.userName
    });
  });
  
  socket.on('answer', (data) => {
    console.log(`WebRTC answer from ${socket.id} to ${data.target}`);
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id,
      senderName: socket.userName
    });
  });
  
  socket.on('ice-candidate', (data) => {
    console.log(`ICE candidate from ${socket.id} to ${data.target}`);
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });
  
  // Chat message handling
  socket.on('chat-message', (data) => {
    const { roomId, message, userName } = data;
    console.log(`Chat message in ${roomId} from ${userName}: ${message}`);
    
    io.to(roomId).emit('chat-message', {
      message: message,
      userName: userName,
      timestamp: new Date(),
      socketId: socket.id
    });
  });
  
  // Handle user disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    if (socket.roomId && rooms[socket.roomId]) {
      const room = rooms[socket.roomId];
      
      // Remove participant from room
      room.participants = room.participants.filter(p => p.socketId !== socket.id);
      
      // Notify other participants
      socket.to(socket.roomId).emit('user-left', {
        socketId: socket.id,
        userName: socket.userName
      });
      
      // Update participant count
      io.to(socket.roomId).emit('participant-count-update', {
        count: room.participants.length,
        maxCapacity: room.maxCapacity
      });
      
      // Clean up empty rooms
      if (room.participants.length === 0) {
        delete rooms[socket.roomId];
        console.log(`Room ${socket.roomId} deleted (empty)`);
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
