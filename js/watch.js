const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new socketIo.Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const rooms = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join_room', (data) => {
        const { room, userName } = data;
        socket.join(room);
        if (!rooms[room]) rooms[room] = [];

        // --- THIS PART IS FOR THE VOICE CHAT ---
        const existingVoiceUsers = rooms[room].filter(user => user.voiceReady).map(user => user.id);
        socket.emit('existing-voice-users', existingVoiceUsers);

        rooms[room].push({ id: socket.id, name: userName, voiceReady: false });
        console.log(`${userName} (${socket.id}) joined room: ${room}`);
        
        // --- THIS PART IS FOR THE USER LOGOS ---
        const userNames = rooms[room].map(user => user.name);
        io.to(room).emit('update_users', userNames);
    });

    // --- ADDED VOICE CHAT SIGNALING EVENTS ---
    socket.on('ready-for-voice', ({ room }) => {
        const user = rooms[room]?.find(u => u.id === socket.id);
        if (user) user.voiceReady = true;
        socket.to(room).emit('user-joined-voice', socket.id);
    });

    socket.on('voice-offer', (data) => {
        socket.to(data.to).emit('voice-offer', { offer: data.offer, from: socket.id });
    });

    socket.on('voice-answer', (data) => {
        socket.to(data.to).emit('voice-answer', { answer: data.answer, from: socket.id });
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.to).emit('ice-candidate', { candidate: data.candidate, from: socket.id });
    });
    // --- END OF VOICE CHAT LOGIC ---

    socket.on('draw', (data) => {
        console.log(`Draw event received for room: ${data.room}`);
        socket.to(data.room).emit('draw', data);
    });

    socket.on('clear', (data) => {
        socket.to(data.room).emit('clear');
    });

    socket.on('undo', (data) => {
        socket.to(data.room).emit('undo', { state: data.state });
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        for (const room in rooms) {
            const userIndex = rooms[room].findIndex(user => user.id === socket.id);
            if (userIndex !== -1) {
                rooms[room].splice(userIndex, 1);
                // --- THIS PART IS FOR VOICE & LOGOS ---
                io.to(room).emit('user-left-voice', socket.id); 
                const userNames = rooms[room].map(user => user.name);
                io.to(room).emit('update_users', userNames);
                // --- END OF FIX ---
                if (rooms[room].length === 0) delete rooms[room];
                break;
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`TwinCanvas server running on http://localhost:${PORT}`);
});
