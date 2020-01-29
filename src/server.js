const config = require("./config/config").getConfig();
const app = require("express")();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cookie: config.server.cookieName,
  path: config.server.socketPath
});

io.origins("*:*");
const cors = require("cors");
app.use(cors());

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

const getUserByName = username => {
  return chatClients.find(client => {
    console.log(client.user.username, username);
    return client.user.username === username;
  });
};
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
    const existingUser = getUserByName(username.username);
    console.log(existingUser);
    if (!existingUser) {
      const oldName = socket.client.user.username;
      socket.client.user.username = username.username;
      // socket.emit("set-username", { username: socket.client.user.username });
      io.emit("room-user-change", {
        users: getChatUsers(),
        message: `${oldName} is now ${socket.client.user.username}.`
      });
    } else {
      socket.emit("set-username-error", "Username Taken");
    }
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
