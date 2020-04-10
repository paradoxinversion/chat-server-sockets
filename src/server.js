const environment = process.env.NODE_ENV;
const config = require("./config/config").getConfig();
const app = require("express")();
const cookieParser = require("cookie-parser");
const http = require("http").createServer(app);
const setupdb = require("./mongo/setupdb");
const jdenticon = require("jdenticon");
const io = require("socket.io")(http, {
  cookie: false,
});
const userActions = require("./mongo/actions/User");
const socketActions = require("./sockets/socketActions");
const socketEvents = require("./sockets/socketEvents");
const userApi = require("./rest/v1");
const ChatManager = require("./chatManager");
const User = require("./mongo/models/User");
io.origins("*:*");

// CORS is set in nginx in production
if (environment !== "production") {
  const cors = require("cors");
  app.use(cors({ origin: "http://localhost:3000", credentials: true }));
}

setupdb(false);

app.use(cookieParser());
app.use(require("express").json());

const chatManager = new ChatManager();

io.use(socketActions.authorizeSocket);

io.on("connection", function (socket) {
  chatManager.addChatClient(socket.client, socket.user);

  socket.emit("user-connected", {
    user: socket.client.user,
    chatHistory: chatManager.chatHistory.map((entry) => {
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
    users: chatManager.getChatUsers(),
    message: `${socket.client.user.username} has entered the chat room.`,
    user: socket.client.user,
  });

  socket.on("chat-message-sent", (data) => {
    socketEvents.sendChatMessage(io, socket, data, chatManager.chatHistory);
  });
  socket.on("get-banned-users", () => {
    socketEvents.getBannedUsers(socket);
  });

  socket.on("ban-user", (userSocketId) => {
    socketEvents.banUser(io, userSocketId, chatManager.getClientBySocketId);
  });

  socket.on("change-user-account-status", async function ({ userId, status }) {
    socketEvents.changeAccountStatus(io, userId, status);
  });

  socket.on("block-user", async function ({ userId }) {
    socketEvents.blockUser(io, socket, userId, chatManager.getClientByUserId);
  });

  socket.on("unblock-user", async function (userId) {
    socketEvents.unblockUser(io, socket, userId, chatManager.getClientByUserId);
  });

  socket.on("private-chat-initiated", function (userId) {
    socketEvents.initatePrivateChat(io, socket, userId);
  });

  socket.on("set-username", async function ({ username, user }) {
    socketEvents.setUsername(
      io,
      sockets,
      username,
      user,
      chatManager.getChatUsers
    );
  });

  socket.on("set-user-photo", async function ({ userId, photoURL }) {
    socketEvents.setUserPhoto(io, socket, userId, photoURL);
  });

  socket.on("disconnect", function () {
    socketEvents.disconnect(
      io,
      socket,
      chatManager.removeChatClient,
      chatManager.getChatUsers
    );
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
