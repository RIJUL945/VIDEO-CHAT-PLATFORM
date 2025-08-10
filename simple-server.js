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
    created: new Date(),
    isLocked: false,
    password: null,
    waitingRoom: [],
    chatHistory: [],
    isRecording: false
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
  
  // Join Room
  socket.on('join-room', (data) => {
    const { roomId, userName, password = null } = data;
    console.log(`${userName} trying to join room ${roomId}`);
    
    if (!rooms[roomId]) {
      console.log(`❌ Room ${roomId} not found`);
      socket.emit('join-error', { message: 'Room not found' });
      return;
    }
    
    const room = rooms[roomId];
    
    // Check password if room is protected
    if (room.password && room.password !== password) {
      socket.emit('join-error', { message: 'Incorrect password' });
      return;
    }
    
    // Check if room is locked
    if (room.isLocked && room.participants.length > 0) {
      socket.emit('join-error', { message: 'Room is locked' });
      return;
    }
    
    // Check capacity
    if (room.participants.length >= room.maxCapacity) {
      socket.emit('join-error', { message: 'Room is full' });
      return;
    }
    
    // Create participant object
    const participant = {
      id: socket.id,
      name: userName,
      joinedAt: new Date(),
      isHost: room.participants.length === 0, // First person is host
      isMuted: false,
      isVideoOff: false,
      isHandRaised: false,
      isScreenSharing: false,
      connectionQuality: 'good'
    };
    
    // Add to room
    room.participants.push(participant);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = userName;
    socket.isHost = participant.isHost;
    
    console.log(`${userName} joined room ${roomId}. Total: ${room.participants.length}`);
    
    // Notify user they joined successfully
    socket.emit('room-joined', {
      roomId: roomId,
      participants: room.participants,
      isHost: participant.isHost,
      chatHistory: room.chatHistory
    });
    
    // Notify others in room about new participant
    socket.to(roomId).emit('user-joined', participant);
    
    // Send updated participant list to everyone
    io.to(roomId).emit('participants-updated', room.participants);
  });
  
  // Leave Room
  socket.on('leave-room', () => {
    if (socket.roomId) {
      const room = rooms[socket.roomId];
      if (room) {
        room.participants = room.participants.filter(p => p.id !== socket.id);
        socket.to(socket.roomId).emit('user-left', { 
          id: socket.id, 
          name: socket.userName 
        });
        io.to(socket.roomId).emit('participants-updated', room.participants);
        console.log(`${socket.userName} left room ${socket.roomId}`);
        
        // If host left, assign new host
        if (socket.isHost && room.participants.length > 0) {
          room.participants[0].isHost = true;
          io.to(socket.roomId).emit('new-host', room.participants[0]);
        }
      }
    }
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    if (socket.roomId) {
      const room = rooms[socket.roomId];
      if (room) {
        room.participants = room.participants.filter(p => p.id !== socket.id);
        socket.to(socket.roomId).emit('user-left', { 
          id: socket.id, 
          name: socket.userName 
        });
        io.to(socket.roomId).emit('participants-updated', room.participants);
        console.log(`${socket.userName} disconnected from room ${socket.roomId}`);
        
        // If host disconnected, assign new host
        if (socket.isHost && room.participants.length > 0) {
          room.participants[0].isHost = true;
          io.to(socket.roomId).emit('new-host', room.participants[0]);
        }
      }
    }
  });
  
  // WebRTC Signaling
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
  
  // Chat Messages
  socket.on('chat-message', (data) => {
    const { message, type = 'text', fileData = null } = data;
    const chatMessage = {
      id: Date.now(),
      sender: socket.userName,
      senderId: socket.id,
      message: message,
      type: type,
      fileData: fileData,
      timestamp: new Date()
    };
    
    // Store in room history
    if (rooms[socket.roomId]) {
      rooms[socket.roomId].chatHistory.push(chatMessage);
    }
    
    io.to(socket.roomId).emit('chat-message', chatMessage);
    console.log(`Chat message in ${socket.roomId}: ${socket.userName}: ${message}`);
  });
  
  // Private Messages
  socket.on('private-message', (data) => {
    const { targetUserId, message } = data;
    const privateMessage = {
      id: Date.now(),
      sender: socket.userName,
      senderId: socket.id,
      message: message,
      type: 'private',
      timestamp: new Date()
    };
    
    socket.to(targetUserId).emit('private-message', privateMessage);
    socket.emit('private-message-sent', privateMessage);
  });
  
  // Screen Sharing
  socket.on('start-screen-share', () => {
    const room = rooms[socket.roomId];
    if (room) {
      const participant = room.participants.find(p => p.id === socket.id);
      if (participant) {
        participant.isScreenSharing = true;
        io.to(socket.roomId).emit('user-started-screen-share', {
          userId: socket.id,
          userName: socket.userName
        });
      }
    }
  });
  
  socket.on('stop-screen-share', () => {
    const room = rooms[socket.roomId];
    if (room) {
      const participant = room.participants.find(p => p.id === socket.id);
      if (participant) {
        participant.isScreenSharing = false;
        io.to(socket.roomId).emit('user-stopped-screen-share', {
          userId: socket.id,
          userName: socket.userName
        });
      }
    }
  });
  
  // Audio/Video Controls
  socket.on('toggle-audio', (data) => {
    const { isMuted } = data;
    const room = rooms[socket.roomId];
    if (room) {
      const participant = room.participants.find(p => p.id === socket.id);
      if (participant) {
        participant.isMuted = isMuted;
        io.to(socket.roomId).emit('user-audio-toggled', {
          userId: socket.id,
          userName: socket.userName,
          isMuted: isMuted
        });
      }
    }
  });
  
  socket.on('toggle-video', (data) => {
    const { isVideoOff } = data;
    const room = rooms[socket.roomId];
    if (room) {
      const participant = room.participants.find(p => p.id === socket.id);
      if (participant) {
        participant.isVideoOff = isVideoOff;
        io.to(socket.roomId).emit('user-video-toggled', {
          userId: socket.id,
          userName: socket.userName,
          isVideoOff: isVideoOff
        });
      }
    }
  });
  
  // Raise Hand Feature
  socket.on('raise-hand', (data) => {
    const { isHandRaised } = data;
    const room = rooms[socket.roomId];
    if (room) {
      const participant = room.participants.find(p => p.id === socket.id);
      if (participant) {
        participant.isHandRaised = isHandRaised;
        io.to(socket.roomId).emit('user-hand-raised', {
          userId: socket.id,
          userName: socket.userName,
          isHandRaised: isHandRaised
        });
      }
    }
  });
  
  // Reactions
  socket.on('send-reaction', (data) => {
    const { reaction } = data;
    io.to(socket.roomId).emit('user-reaction', {
      userId: socket.id,
      userName: socket.userName,
      reaction: reaction,
      timestamp: Date.now()
    });
  });
  
  // Host Controls
  socket.on('mute-all', () => {
    const room = rooms[socket.roomId];
    if (room && socket.isHost) {
      room.participants.forEach(p => {
        if (p.id !== socket.id) {
          p.isMuted = true;
        }
      });
      socket.to(socket.roomId).emit('host-muted-all');
      io.to(socket.roomId).emit('participants-updated', room.participants);
    }
  });
  
  socket.on('mute-participant', (data) => {
    const { targetUserId } = data;
    const room = rooms[socket.roomId];
    if (room && socket.isHost) {
      const participant = room.participants.find(p => p.id === targetUserId);
      if (participant) {
        participant.isMuted = true;
        socket.to(targetUserId).emit('host-muted-you');
        io.to(socket.roomId).emit('user-audio-toggled', {
          userId: targetUserId,
          isMuted: true
        });
      }
    }
  });
  
  socket.on('remove-participant', (data) => {
    const { targetUserId } = data;
    const room = rooms[socket.roomId];
    if (room && socket.isHost) {
      socket.to(targetUserId).emit('removed-by-host');
      room.participants = room.participants.filter(p => p.id !== targetUserId);
      io.to(socket.roomId).emit('participants-updated', room.participants);
    }
  });
  
  socket.on('lock-room', () => {
    const room = rooms[socket.roomId];
    if (room && socket.isHost) {
      room.isLocked = true;
      io.to(socket.roomId).emit('room-locked');
    }
  });
  
  socket.on('unlock-room', () => {
    const room = rooms[socket.roomId];
    if (room && socket.isHost) {
      room.isLocked = false;
      io.to(socket.roomId).emit('room-unlocked');
    }
  });
  
  // Recording Controls
  socket.on('start-recording', () => {
    const room = rooms[socket.roomId];
    if (room && socket.isHost) {
      room.isRecording = true;
      io.to(socket.roomId).emit('recording-started');
    }
  });
  
  socket.on('stop-recording', () => {
    const room = rooms[socket.roomId];
    if (room && socket.isHost) {
      room.isRecording = false;
      io.to(socket.roomId).emit('recording-stopped');
    }
  });
  
  // Connection Quality Updates
  socket.on('connection-quality', (data) => {
    const { quality } = data;
    const room = rooms[socket.roomId];
    if (room) {
      const participant = room.participants.find(p => p.id === socket.id);
      if (participant) {
        participant.connectionQuality = quality;
        socket.to(socket.roomId).emit('user-connection-quality', {
          userId: socket.id,
          quality: quality
        });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Video Chat Server running on port ${PORT}`);
  console.log(`📱 Access your platform at: http://localhost:${PORT}`);
});
