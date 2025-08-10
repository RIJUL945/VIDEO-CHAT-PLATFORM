// Enhanced Video Chat Room JavaScript
const socket = io();
let localStream = null;
let peerConnections = {};
let roomId = null;
let userName = null;
let isHost = false;
let isMuted = false;
let isVideoOff = false;
let isHandRaised = false;
let isScreenSharing = false;

// DOM Elements
const joinModal = document.getElementById('joinModal');
const userNameInput = document.getElementById('userNameInput');
const joinMeetingBtn = document.getElementById('joinMeetingBtn');
const videoGrid = document.getElementById('videoGrid');
const chatSidebar = document.getElementById('chatSidebar');
const participantsPanel = document.getElementById('participantsPanel');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const participantsList = document.getElementById('participantsList');
const participantCount = document.getElementById('participantCount');
const meetingTitle = document.getElementById('meetingTitle');
const recordingIndicator = document.getElementById('recordingIndicator');
const reactionsContainer = document.getElementById('reactionsContainer');

// Control buttons
const micBtn = document.getElementById('micBtn');
const videoBtn = document.getElementById('videoBtn');
const screenShareBtn = document.getElementById('screenShareBtn');
const raiseHandBtn = document.getElementById('raiseHandBtn');
const reactionsBtn = document.getElementById('reactionsBtn');
const chatBtn = document.getElementById('chatBtn');
const participantsBtn = document.getElementById('participantsBtn');
const leaveBtn = document.getElementById('leaveBtn');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const closeChatBtn = document.getElementById('closeChatBtn');
const closeParticipantsBtn = document.getElementById('closeParticipantsBtn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    roomId = window.location.pathname.split('/').pop();
    meetingTitle.textContent = `Room ${roomId}`;
    showJoinModal();
    setupEventListeners();
});

function setupEventListeners() {
    // Join modal
    joinMeetingBtn.addEventListener('click', joinRoom);
    userNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinRoom();
    });

    // Control buttons
    micBtn.addEventListener('click', toggleAudio);
    videoBtn.addEventListener('click', toggleVideo);
    screenShareBtn.addEventListener('click', toggleScreenShare);
    raiseHandBtn.addEventListener('click', toggleRaiseHand);
    reactionsBtn.addEventListener('click', showReactionsMenu);
    chatBtn.addEventListener('click', toggleChat);
    participantsBtn.addEventListener('click', toggleParticipants);
    leaveBtn.addEventListener('click', leaveRoom);

    // Chat
    sendMessageBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    closeChatBtn.addEventListener('click', () => chatSidebar.classList.remove('open'));
    closeParticipantsBtn.addEventListener('click', () => participantsPanel.classList.remove('open'));
}

function showJoinModal() {
    joinModal.classList.add('show');
    userNameInput.focus();
}

function hideJoinModal() {
    joinModal.classList.remove('show');
}

async function joinRoom() {
    const name = userNameInput.value.trim();
    if (!name) {
        alert('Please enter your name');
        return;
    }

    userName = name;
    hideJoinModal();

    try {
        // Get user media
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1280, height: 720 },
            audio: { echoCancellation: true, noiseSuppression: true }
        });

        // Add local video
        addVideoElement('local', localStream, userName, true);
        
        // Join room via socket
        socket.emit('join-room', { roomId, userName });
        
    } catch (error) {
        console.error('Error accessing media devices:', error);
        // Join without media
        socket.emit('join-room', { roomId, userName });
    }
}

function addVideoElement(id, stream, name, isLocal = false) {
    const existingContainer = document.getElementById(`video-${id}`);
    if (existingContainer) {
        existingContainer.remove();
    }

    const videoContainer = document.createElement('div');
    videoContainer.className = 'video-container';
    videoContainer.id = `video-${id}`;

    const video = document.createElement('video');
    video.className = 'video-element';
    video.autoplay = true;
    video.playsInline = true;
    video.muted = isLocal;

    if (stream) {
        video.srcObject = stream;
    }

    const overlay = document.createElement('div');
    overlay.className = 'video-overlay';

    const participantName = document.createElement('div');
    participantName.className = 'participant-name';
    participantName.textContent = isLocal ? `${name} (You)` : name;

    const participantStatus = document.createElement('div');
    participantStatus.className = 'participant-status';

    overlay.appendChild(participantName);
    overlay.appendChild(participantStatus);
    videoContainer.appendChild(video);
    videoContainer.appendChild(overlay);

    // Clear loading state and add video
    if (videoGrid.querySelector('.loading')) {
        videoGrid.innerHTML = '';
    }
    videoGrid.appendChild(videoContainer);
}

function removeVideoElement(id) {
    const videoContainer = document.getElementById(`video-${id}`);
    if (videoContainer) {
        videoContainer.remove();
    }
}

async function createPeerConnection(targetId) {
    const peerConnection = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });

    // Add local stream
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    // Handle remote stream
    peerConnection.ontrack = (event) => {
        const [remoteStream] = event.streams;
        addVideoElement(targetId, remoteStream, 'Remote User');
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: targetId,
                candidate: event.candidate
            });
        }
    };

    peerConnections[targetId] = peerConnection;
    return peerConnection;
}

async function toggleAudio() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            isMuted = !audioTrack.enabled;
        }
    } else {
        isMuted = !isMuted;
    }

    micBtn.classList.toggle('muted', isMuted);
    socket.emit('toggle-audio', { isMuted });
}

async function toggleVideo() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            isVideoOff = !videoTrack.enabled;
        }
    } else {
        isVideoOff = !isVideoOff;
    }

    videoBtn.classList.toggle('video-off', isVideoOff);
    socket.emit('toggle-video', { isVideoOff });
}

async function toggleScreenShare() {
    if (!isScreenSharing) {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });

            // Replace video track in all peer connections
            const videoTrack = screenStream.getVideoTracks()[0];
            Object.values(peerConnections).forEach(pc => {
                const sender = pc.getSenders().find(s => 
                    s.track && s.track.kind === 'video'
                );
                if (sender) {
                    sender.replaceTrack(videoTrack);
                }
            });

            // Update local video
            const localVideo = document.querySelector('#video-local .video-element');
            if (localVideo) {
                localVideo.srcObject = screenStream;
            }

            isScreenSharing = true;
            screenShareBtn.classList.add('active');
            socket.emit('start-screen-share');

            // Handle screen share end
            videoTrack.onended = () => {
                stopScreenShare();
            };

        } catch (error) {
            console.error('Error starting screen share:', error);
        }
    } else {
        stopScreenShare();
    }
}

async function stopScreenShare() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        Object.values(peerConnections).forEach(pc => {
            const sender = pc.getSenders().find(s => 
                s.track && s.track.kind === 'video'
            );
            if (sender && videoTrack) {
                sender.replaceTrack(videoTrack);
            }
        });

        // Restore local video
        const localVideo = document.querySelector('#video-local .video-element');
        if (localVideo) {
            localVideo.srcObject = localStream;
        }
    }

    isScreenSharing = false;
    screenShareBtn.classList.remove('active');
    socket.emit('stop-screen-share');
}

function toggleRaiseHand() {
    isHandRaised = !isHandRaised;
    raiseHandBtn.classList.toggle('active', isHandRaised);
    socket.emit('raise-hand', { isHandRaised });
}

function showReactionsMenu() {
    const reactions = ['👍', '👏', '❤️', '😂', '😮', '🎉'];
    const menu = document.createElement('div');
    menu.className = 'reactions-menu';
    menu.style.cssText = `
        position: absolute;
        bottom: 70px;
        right: 20px;
        background: #2d2d2d;
        border-radius: 8px;
        padding: 10px;
        display: flex;
        gap: 10px;
        z-index: 1000;
    `;

    reactions.forEach(reaction => {
        const btn = document.createElement('button');
        btn.textContent = reaction;
        btn.style.cssText = `
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            padding: 5px;
            border-radius: 4px;
        `;
        btn.onclick = () => {
            sendReaction(reaction);
            menu.remove();
        };
        menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    setTimeout(() => menu.remove(), 5000);
}

function sendReaction(reaction) {
    socket.emit('send-reaction', { reaction });
    showReaction(reaction);
}

function showReaction(reaction) {
    const reactionEl = document.createElement('div');
    reactionEl.className = 'reaction';
    reactionEl.textContent = reaction;
    reactionsContainer.appendChild(reactionEl);
    setTimeout(() => reactionEl.remove(), 3000);
}

function toggleChat() {
    chatSidebar.classList.toggle('open');
    participantsPanel.classList.remove('open');
}

function toggleParticipants() {
    participantsPanel.classList.toggle('open');
    chatSidebar.classList.remove('open');
}

function sendMessage() {
    const message = chatInput.value.trim();
    if (message) {
        socket.emit('chat-message', { message });
        chatInput.value = '';
    }
}

function addChatMessage(data) {
    const messageEl = document.createElement('div');
    messageEl.className = 'message';

    const header = document.createElement('div');
    header.className = 'message-header';

    const sender = document.createElement('span');
    sender.className = 'message-sender';
    sender.textContent = data.sender;

    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = new Date(data.timestamp).toLocaleTimeString();

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = data.message;

    header.appendChild(sender);
    header.appendChild(time);
    messageEl.appendChild(header);
    messageEl.appendChild(content);

    chatMessages.appendChild(messageEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateParticipantsList(participants) {
    participantsList.innerHTML = '';
    participantCount.textContent = `${participants.length} participants`;

    participants.forEach(participant => {
        const item = document.createElement('div');
        item.className = 'participant-item';

        const avatar = document.createElement('div');
        avatar.className = 'participant-avatar';
        avatar.textContent = participant.name.charAt(0).toUpperCase();

        const info = document.createElement('div');
        info.className = 'participant-info';

        const name = document.createElement('div');
        name.className = 'participant-name-text';
        name.textContent = participant.name;

        const status = document.createElement('div');
        status.className = 'participant-status-text';
        const statusParts = [];
        if (participant.isHost) statusParts.push('Host');
        if (participant.isMuted) statusParts.push('Muted');
        if (participant.isHandRaised) statusParts.push('Hand raised');
        status.textContent = statusParts.join(', ') || 'Active';

        info.appendChild(name);
        info.appendChild(status);
        item.appendChild(avatar);
        item.appendChild(info);
        participantsList.appendChild(item);
    });
}

function leaveRoom() {
    if (confirm('Are you sure you want to leave the meeting?')) {
        socket.emit('leave-room');
        window.location.href = '/';
    }
}

// Socket event listeners
socket.on('room-joined', async (data) => {
    isHost = data.isHost;
    updateParticipantsList(data.participants);
    
    // Load chat history
    if (data.chatHistory) {
        data.chatHistory.forEach(msg => addChatMessage(msg));
    }
});

socket.on('join-error', (data) => {
    alert(data.message);
    window.location.href = '/';
});

socket.on('user-joined', async (participant) => {
    console.log('User joined:', participant.name);
    
    // Create peer connection and send offer
    const peerConnection = await createPeerConnection(participant.id);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    socket.emit('offer', {
        target: participant.id,
        offer: offer
    });
});

socket.on('user-left', (data) => {
    console.log('User left:', data.name);
    removeVideoElement(data.id);
    if (peerConnections[data.id]) {
        peerConnections[data.id].close();
        delete peerConnections[data.id];
    }
});

socket.on('participants-updated', (participants) => {
    updateParticipantsList(participants);
});

socket.on('offer', async (data) => {
    const peerConnection = await createPeerConnection(data.sender);
    await peerConnection.setRemoteDescription(data.offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('answer', {
        target: data.sender,
        answer: answer
    });
});

socket.on('answer', async (data) => {
    const peerConnection = peerConnections[data.sender];
    if (peerConnection) {
        await peerConnection.setRemoteDescription(data.answer);
    }
});

socket.on('ice-candidate', async (data) => {
    const peerConnection = peerConnections[data.sender];
    if (peerConnection) {
        await peerConnection.addIceCandidate(data.candidate);
    }
});

socket.on('chat-message', (data) => {
    addChatMessage(data);
});

socket.on('user-reaction', (data) => {
    showReaction(data.reaction);
});

socket.on('user-audio-toggled', (data) => {
    const videoContainer = document.getElementById(`video-${data.userId}`);
    if (videoContainer) {
        const status = videoContainer.querySelector('.participant-status');
        if (data.isMuted) {
            status.innerHTML += '<span class="status-icon muted">🔇</span>';
        } else {
            const mutedIcon = status.querySelector('.muted');
            if (mutedIcon) mutedIcon.remove();
        }
    }
});

socket.on('user-video-toggled', (data) => {
    const videoContainer = document.getElementById(`video-${data.userId}`);
    if (videoContainer) {
        const video = videoContainer.querySelector('.video-element');
        if (data.isVideoOff) {
            video.style.display = 'none';
        } else {
            video.style.display = 'block';
        }
    }
});

socket.on('recording-started', () => {
    recordingIndicator.classList.add('active');
});

socket.on('recording-stopped', () => {
    recordingIndicator.classList.remove('active');
});

socket.on('host-muted-you', () => {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = false;
            isMuted = true;
            micBtn.classList.add('muted');
        }
    }
    alert('You have been muted by the host');
});

socket.on('removed-by-host', () => {
    alert('You have been removed from the meeting by the host');
    window.location.href = '/';
});
