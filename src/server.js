const environment = process.env.NODE_ENV;
const config = require("./config/config").getConfig();
const app = require("express")();
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const http = require("http").createServer(app);
const setupdb = require("./mongo/setupdb");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const jdenticon = require("jdenticon");
const io = require("socket.io")(http, {
  cookie: false,
});
const userActions = require("./mongo/actions/User");
const socketActions = require("./socketio/socketActions");
const socketEvents = require("./socketio/socketEvents");
const userApi = require("./rest/v1");
const User = require("./mongo/models/User");
io.origins("*:*");

// CORS is set in nginx in production
if (environment !== "production") {
  const cors = require("cors");
  app.use(cors({ origin: "http://localhost:3000", credentials: true }));
}

const database = setupdb(false);
passport.use(
  new LocalStrategy(async function (username, password, done) {
    const user = await User.findOne({ username: username });

    if (!user) {
      return done(null, false, { message: "Incorrect username." });
    }
    if (!user.checkPassword(password)) {
      return done(null, false, { message: "Incorrect password." });
    }
    return done(null, user);
  })
);

passport.serializeUser(function (user, done) {
  done(null, user.id);
});

passport.deserializeUser(async function (id, done) {
  const user = User.findById(id);
  done(null, user);
});

app.use(passport.initialize());
app.use(cookieParser());
app.use(require("express").json());

let chatClients = [];
let chatHistory = [];

const createUser = (clientId, user) => {
  return {
    username: user.username,
    avatar: jdenticon.toPng(user.username, 150),
    id: clientId,
    socketId: clientId,
    iid: user.iid,
    userId: user.userId,
    blockList: user.blockList.map((user) => user._id.toString()),
    blockedBy: user.blockedBy.map((user) => user._id.toString()),
    role: user.role,
    accountStatus: user.accountStatus,
    profilePhotoURL: user.profilePhotoURL,
  };
};

/**
 * Adds a chat client to the `chatClients` array if one doesn't
 * already exist.
 * @param {*} client - A socket client
 */
const addChatClient = (client, user) => {
  let clientExists = false;
  for (let x = 0; x < chatClients.length; x++) {
    const chatClient = chatClients[x];
    if (chatClient.id === client.id) client = true;
  }

  // If none exists yet, add it
  if (!clientExists) {
    client.user = createUser(client.id, user);

    chatClients.push(client);
  }
  return client;
};

const removeChatClient = (clientId) => {
  chatClients = chatClients.filter((client) => client.id !== clientId);
  return chatClients;
};

/**
 * Return an array of chat users (from the clients array)
 */
const getChatUsers = () => chatClients.map((client) => client.user);

const getUserByName = (username) => {
  return chatClients.find((client) => {
    return client.user.username === username;
  });
};

const getClientBySocketId = (socketId) => {
  return chatClients.find((client) => {
    return client.id === socketId;
  });
};

const getClientByUserId = (userId) => {
  return chatClients.find((client) => client.user.userId === userId);
};

io.use(socketActions.authorizeSocket);

io.on("connection", function (socket) {
  addChatClient(socket.client, socket.user);

  socket.emit("user-connected", {
    user: socket.client.user,
    chatHistory: chatHistory.map((entry) => {
      const chatEntry = { ...entry };
      if (chatEntry.id !== "system")
        entry.user.avatar = jdenticon.toPng(entry.user.username, 150);
      return chatEntry;
    }),
  });

  socket.emit("chat-message-broadcast", {
    id: "system",
    time: Date.now(),
    message: "Welcome to the chatroom!",
  });

  io.emit("room-user-change", {
    users: getChatUsers(),
    message: `${socket.client.user.username} has entered the chat room.`,
    user: socket.client.user,
  });

  socket.on("chat-message-sent", (data) => {
    socketEvents.sendChatMessage(io, socket, data, chatHistory);
  });
  socket.on("get-banned-users", () => {
    socketEvents.getBannedUsers(socket);
  });

  socket.on("ban-user", (userSocketId) => {
    socketEvents.banUser(io, userSocketId, getClientBySocketId);
  });

  socket.on("change-user-account-status", async function ({ userId, status }) {
    socketEvents.changeAccountStatus(io, userId, status);
  });

  socket.on("block-user", async function ({ userId }) {
    socketEvents.blockUser(io, socket, userId, getClientByUserId);
  });

  socket.on("unblock-user", async function (userId) {
    socketEvents.unblockUser(io, socket, userId, getClientByUserId);
  });

  socket.on("private-chat-initiated", function (userId) {
    socketEvents.initatePrivateChat(io, socket, userId);
  });

  socket.on("set-username", async function ({ username, user }) {
    socketEvents.setUsername(io, sockets, username, user, getChatUsers);
  });

  socket.on("set-user-photo", async function ({ userId, photoURL }) {
    socketEvents.setUserPhoto(io, socket, userId, photoURL);
  });

  socket.on("disconnect", function () {
    socketEvents.disconnect(io, socket, removeChatClient, getChatUsers);
  });
});

app.post(`/chattr/sign-in`, async (req, res) => {
  userApi.signIn(req, res);
});

app.post(`/chattr/sign-up`, async (req, res) => {
  userApi.signUp(req, res);
});

app.get(`/chattr/check-auth`, async (req, res) => {
  userApi.checkAuthorization(req, res);
});

app.get("/chattr/banned-users", async (req, res) => {
  userApi.getBannedUsers(req, res);
});

app.get("/chattr/users", async (req, res) => {
  userApi.getUsers(req, res);
});

app.get("/chattr/blocked-users", async (req, res) => {
  userApi.getBlockedUsers(req, res);
});

app.delete("/chattr/user", async (req, res) => {
  userApi.deleteUser(req, res);
});

app.get(`/chattr/logout`, async (req, res) => {
  userApi.logOut(req, res);
});

app.post(`/chattr/update-password`, async (req, res) => {
  userApi.updatePassword(req, res);
});

app.post(`/chattr/set-photo`, async (req, res) => {
  userApi.setPhoto(req, res);
});
app.post(`/chattr/pending-users`, async (req, res) => {
  userApi.getPendingUsers(req, res);
});
app.post(`/chattr/confirm-user`, async (req, res) => {
  userApi.confirmUser(req, res);
});
http.listen(config.server.port, async function () {
  console.log(`Listening on port ${config.server.port}`);
  const admin = await User.findOne({ role: 2 });
  if (!admin) {
    console.log(
      "No Administrator-- Creating default admin. Change the password as soon as possible"
    );
    const adminUser = await userActions.createUser({
      username: process.env.DEFAULT_ADMIN_USERNAME,
      password: process.env.DEFAULT_ADMIN_PASSWORD,
    });
    adminUser.role = 2;
    adminUser.activated = true;
    await adminUser.save();
  }
});
