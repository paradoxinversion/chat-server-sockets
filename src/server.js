const config = require("./config/config").getConfig();
console.log(config);
const app = require("express")();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cookie: config.server.cookieName
});
const whitelist = config.server.allowedOrigins.split(",");
io.origins(whitelist);
const cors = require("cors");
var corsOptions = {
  origin: function(origin, callback) {
    if (whitelist.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  }
};
app.use(cors(corsOptions));

let chatClients = [];

const createUser = clientId => {
  return {
    username: `Anon-${clientId}`,
    avatar: `https://i.pravatar.cc/150?u=${clientId}`,
    id: clientId
  };
};

/**
 * Adds a chat client to the `chatClients` array if one doesn't
 * already exist.
 * @param {*} client - A socket client
 */
const addChatClient = client => {
  let clientExists = false;
  for (let x = 0; x < chatClients.length; x++) {
    const chatClient = chatClients[x];
    if (chatClient.id === client.id) client = true;
  }

  // If none exists yet, add it
  if (!clientExists) {
    client.user = createUser(client.id);
    chatClients.push(client);
    console.log(`New chat user entered: ${client.user.username}`);
  }
  return client;
};

const removeChatClient = clientId => {
  chatClients = chatClients.filter(client => client.id !== clientId);
  return chatClients;
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
    const message = {
      id: socket.id,
      user: socket.client.user,
      message: data.message,
      time: Date.now(),
      from: data.from || "",
      to: data.to || ""
    };

    if (data.to) {
      socket.to(data.to).emit("pm", message);
      socket.emit("pm", message);
    } else {
      io.emit("chat-message-broadcast", message);
    }
  });

  socket.on("private-chat-initiated", function(userId) {
    const [p1, p2] = [socket.id, userId].sort((a, b) => a - b);
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

http.listen(config.server.port, function() {
  console.log(`Listening on port ${config.server.port}`);
});
