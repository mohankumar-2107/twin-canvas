const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Corrected line: Serve all static files from the root project directory
app.use(express.static(__dirname));

const rooms = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join_room', (data) => {
        const { room, userName } = data;
        socket.join(room);
        
        // Store user info
        if (!rooms[room]) {
            rooms[room] = [];
        }
        rooms[room].push({ id: socket.id, name: userName });

        console.log(`${userName} (${socket.id}) joined room: ${room}`);
        // Notify others in the room
        socket.to(room).emit('user_joined', { userName });
    });

    socket.on('draw', (data) => {
        // Broadcast drawing data to everyone else in the same room
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
        // Find which room the user was in and notify others
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