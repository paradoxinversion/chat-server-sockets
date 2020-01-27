var app = require("express")();
var http = require("http").createServer(app);
var io = require("socket.io")(http, {
  cookie: "chat-app"
});
const cors = require("cors");
app.use(cors());

let chatClients = [];

const addChatClient = client => {
  const newClientUsername = `Anon-${client.id}`;
  let clientExists = false;
  for (let x = 0; x < chatClients.length; x++) {
    const chatClient = chatClients[x];
    if (chatClient.id === client.id) client = true;
  }

  // If none exists yet, add it
  if (!clientExists) {
    client.user = {
      username: newClientUsername,
      avatar: `https://i.pravatar.cc/150?u=${newClientUsername}`,
      id: client.id
    };
    chatClients.push(client);
    console.log(`New chat user entered: ${client.user.username}`);
  }
  return client;
};

const removeChatClient = clientId => {
  chatClients = chatClients.filter(client => client.id !== clientId);
  return chatClients;
};

const getChatClient = clientId => {
  return chatClients.find(client => client.id === clientId);
};
/**
 * Return an array of chat users (from the clients array)
 */
const getChatUsers = () => chatClients.map(client => client.user);

io.on("connection", function(socket) {
  addChatClient(socket.client);

  socket.emit("user-connected", {
    user: socket.client.user
  });

  io.emit("room-user-change", {
    users: getChatUsers(),
    message: `${socket.client.user.username} has entered the chat room.`
  });

  socket.on("chat-message-sent", function(data) {
    console.log(data);
    const message = {
      id: socket.id,
      user: socket.client.user,
      message: data.message,
      time: Date.now(),
      from: data.from || "",
      to: data.to || ""
    };
    if (data.to) {
      // io.to(room).emit("pm", message);
      socket.to(data.to).emit("pm", message);
      socket.emit("pm", message);
    } else {
      io.emit("chat-message-broadcast", message);
    }
  });
  socket.on("private-chat-initiated", function(userId) {
    const [p1, p2] = [socket.id, userId].sort((a, b) => a - b);
    // join this user to a room with the selected user
    const roomName = `${p1}-${p2}`;
    Promise.all([
      socket.join(roomName),
      io.sockets.sockets[userId].join(roomName)
    ]);
    io.to(roomName).emit("private-chat-initiated", roomName);
  });
  socket.on("set-username", function(username) {
    socket.client.user = username;
  });

  socket.on("disconnect", function() {
    removeChatClient(socket.id);
    io.emit("user-disconnected", { username: socket.client.user });
    io.emit("room-user-change", {
      users: getChatUsers(),
      message: `${socket.client.user.username} has left the chat room.`
    });
  });
});

http.listen(3001, function() {
  console.log("listening on *:3000");
});
