const environment = process.env.NODE_ENV;
const config = require("./config/config").getConfig();
const app = require("express")();
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const cookie = require("cookie");
const http = require("http").createServer(app);
const setupdb = require("./mongo/setupdb");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;

const io = require("socket.io")(http, {
  cookie: config.server.cookieName
});
const userActions = require("./mongo/actions/User");
const User = require("./mongo/models/User");
io.origins("*:*");

// CORS is set in nginx in production
if (environment !== "production") {
  const cors = require("cors");
  app.use(cors({ origin: "http://localhost:3000", credentials: true }));
}

const database = setupdb(false);
passport.use(
  new LocalStrategy(async function(username, password, done) {
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

passport.serializeUser(function(user, done) {
  done(null, user.id);
});

passport.deserializeUser(async function(id, done) {
  const user = User.findById(id);
  done(null, user);
});

app.use(passport.initialize());
app.use(cookieParser());
app.use(require("express").json());

let chatClients = [];

const createUser = (clientId, user) => {
  return {
    username: user.username,
    avatar: `https://i.pravatar.cc/150?u=${clientId}`,
    id: clientId,
    iid: user.iid,
    blockList: user.blockList,
    blockedBy: user.blockedBy
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
    return client.user.username === username;
  });
};

const getClientBySocketId = socketId => {
  return chatClients.find(client => {
    return client.id === socketId;
  });
};

// Authorization/preconnection logic
io.use(async (socket, next) => {
  const userToken = cookie.parse(socket.request.headers.cookie).chattr_u;
  if (!userToken) next(new Error("No token provided"));

  const userData = jwt.verify(userToken, "dev");
  if (!userData) next(new Error("Invalid user token"));

  const dbUser = await User.findById(userData.user);
  socket.user = {
    username: dbUser.username,
    iid: dbUser.id,
    blockList: dbUser.blockedUsers,
    blockedBy: dbUser.blockedBy
  };
  if (dbUser) return next();

  return next(new Error("No user found"));
});

io.on("connection", function(socket) {
  addChatClient(socket.client, socket.user);
  socket.emit("user-connected", {
    user: socket.client.user
  });

  io.emit("room-user-change", {
    users: getChatUsers(),
    message: `${socket.client.user.username} has entered the chat room.`,
    user: socket.client.user
  });

  socket.on("chat-message-sent", function(data) {
    const message = {
      id: socket.id,
      user: socket.client.user,
      message: data.message,
      time: Date.now(),
      from: data.from || "",
      fromUID: data.fromUID || "",
      to: data.to || "",
      toUID: data.toUID || ""
    };

    if (data.to) {
      socket.to(data.to).emit("pm", message);
      socket.emit("pm", message);
    } else {
      io.emit("chat-message-broadcast", message);
    }
  });

  socket.on("block-user", async function(userSocketId) {
    const userIID = getClientBySocketId(userSocketId).user.iid;
    const blockResult = await userActions.addUserToBlockList(
      socket.client.user.iid,
      userIID
    );
    socket.emit("block-user", { blocklist: blockResult.blocked });
    io.sockets.sockets[userSocketId].emit("block-user", {
      blockedBy: blockResult.blockedBy
    });
  });

  socket.on("unblock-user", async function(userSocketId) {
    const userIID = getClientBySocketId(userSocketId).user.iid;
    const unblockResult = await userActions.removeUserFromBlockList(
      socket.client.user.iid,
      userIID
    );
    socket.emit("unblock-user", { blocklist: unblockResult.blocked });
    io.sockets.sockets[userSocketId].emit("unblock-user", {
      blockedBy: unblockResult.blockedBy
    });
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
      message: `${socket.client.user.username} has left the chat room.`,
      user: socket.client.user
    });
  });
});

app.post(`/chattr/sign-in`, passport.authenticate("local"), (req, res) => {
  const token = jwt.sign(
    {
      user: req.user.id
    },
    "dev"
  );
  res.cookie("chattr_u", token, { httpOnly: true }).json({ login: "success" });
});

app.post(`/chattr/sign-up`, (req, res) => {
  const newUser = userActions.createUser(req.body);
  const token = jwt.sign(
    {
      user: newUser.id
    },
    "dev"
  );
  res.cookie("chattr_u", token, { httpOnly: true }).json({ login: "success" });
});

app.get(`/chattr/check-auth`, async (req, res) => {
  const token = req.cookies.chattr_u;
  const userData = jwt.verify(token, "dev");
  const user = await User.findById(userData.user);
  if (user) res.json({ login: "success" });
});

http.listen(config.server.port, function() {
  console.log(`Listening on port ${config.server.port}`);
});
