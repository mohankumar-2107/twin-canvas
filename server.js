const express = require('express');
const http = require('http');
// Change this line
const socketIo = require('socket.io'); 
const path = require('path');

const app = express();
const server = http.createServer(app);

// --- MAKE THIS CHANGE ---
// Replace your old io setup with this one
const io = new socketIo.Server(server, {
  cors: {
    origin: "*", // This allows any origin
    methods: ["GET", "POST"]
  }
});
// --- END OF CHANGE ---

const PORT = process.env.PORT || 3000;

// (The rest of your server.js code stays exactly the same)
app.use(express.static(__dirname));

const rooms = {};

io.on('connection', (socket) => {
    // ... all your socket logic is here ...
    console.log(`User connected: ${socket.id}`);

    socket.on('join_room', (data) => {
        const { room, userName } = data;
        socket.join(room);
        
        if (!rooms[room]) {
            rooms[room] = [];
        }
        rooms[room].push({ id: socket.id, name: userName });

        console.log(`${userName} (${socket.id}) joined room: ${room}`);
        socket.to(room).emit('user_joined', { userName });
    });

    socket.on('draw', (data) => {
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
                const [disconnectedUser] = rooms[room].splice(userIndex, 1);
                io.to(room).emit('user_left', { userName: disconnectedUser.name });
                if (rooms[room].length === 0) {
                    delete rooms[room];
                }
                break;
            }
        }
    });
});


server.listen(PORT, () => {
    console.log(`TwinCanvas server running on http://localhost:${PORT}`);
});