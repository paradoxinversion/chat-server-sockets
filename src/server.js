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
  const user = await User.findOne({ username: req.body.username });
  if (user && (await user.checkPassword(req.body.password))) {
    if (!user.activated)
      return res
        .status(403)
        .json({ error: "Your account has not yet been activated." });
    const token = jwt.sign(
      {
        user: user.id,
      },
      process.env.JWT_SECRET_KEY
    );
    res.status(200).json({ login: "success", token });
  } else {
    res.status(401).json({ error: "Incorrect username or password." });
  }
});

app.post(`/chattr/sign-up`, async (req, res) => {
  if (req.body.password.length < 4) {
    return res
      .status(400)
      .json({ error: "Passwords must be at least four characters." });
  }
  await userActions.createUser(req.body);
  res.status(200).json({ signup: "success" });
});

app.get(`/chattr/check-auth`, async (req, res) => {
  const token = req.headers.bearer;
  if (token) {
    try {
      const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findById(userData.user);
      if (user) {
        if (user.accountStatus === "2") {
          return res.status(403).json({ error: "You are banned from chat." });
        }
        return res.status(200).json({ login: "success" });
      }
    } catch (e) {
      return res.status(400).send({ error: e.message });
    }
  } else {
    return res.status(400).send("No token found. You can ignore this error.");
  }
});

app.get("/chattr/banned-users", async (req, res) => {
  const token = req.headers.bearer;
  if (token) {
    try {
      const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findById(userData.user);
      if (user.role > 0) {
        const users = await userActions.getBannedUsers();
        res.status(200).json({ users });
      } else {
        res
          .status(403)
          .json("You do not have sufficient rights to access these records.");
      }
    } catch (e) {
      return res.status(400).send({ error: e.message });
    }
  } else {
    return res.status(401).json({ error: "Request missing access token" });
  }
});

app.get("/chattr/users", async (req, res) => {
  const token = req.headers.bearer;
  if (token) {
    try {
      const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findById(userData.user);
      if (user.role > 0) {
        const users = await userActions.getUsers();

        res.status(200).json({ users });
      } else {
        res
          .status(403)
          .json("You do not have sufficient rights to access these records.");
      }
    } catch (e) {
      return res.status(400).send({ error: e.message });
    }
  } else {
    return res.status(401).json({ error: "Request missing access token" });
  }
});

app.get("/chattr/blocked-users", async (req, res) => {
  const token = req.headers.bearer;
  if (token) {
    try {
      const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findById(userData.user);
      if (user.activated) {
        const names = await Promise.all(
          req.query.userIds.map(async (id) => {
            const user = await User.findById(id);
            if (user) return { userId: user.id, username: user.username };
          })
        );
        res.status(200).json({ names });
      } else {
        res
          .status(403)
          .json("You do not have sufficient rights to access these records.");
      }
    } catch (e) {
      return res.status(400).send({ error: e.message });
    }
  } else {
    return res.status(401).json({ error: "Request missing access token" });
  }
});

app.delete("/chattr/user", async (req, res) => {
  const token = req.headers.bearer;
  if (token) {
    try {
      const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findById(userData.user);
      if (user.role === "2") {
        const deletingUser = await User.findById(req.body.userId);
        const result = await userActions.deleteUser(req.body.userId);

        res.status(200).json({ result });
      } else {
        res
          .status(403)
          .json("You do not have sufficient rights to modify these records.");
      }
    } catch (e) {
      return res.status(400).send({ error: e.message });
    }
  } else {
    return res.status(401).json({ error: "Request missing access token" });
  }
});

app.get(`/chattr/logout`, async (req, res) => {
  if (req.headers.bearer) {
    return res.status(200).json({ logout: "success" });
  } else {
    return res.status(401).json({ error: "Request missing access token" });
  }
});

app.post(`/chattr/update-password`, async (req, res) => {
  if (req.headers.bearer) {
    const token = req.headers.bearer;
    const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
    const user = await User.findById(userData.user);
    if (user) {
      if (req.body.new.length < 4)
        return res
          .status(400)
          .json({ error: "Passwords must be at least four characters." });
      if (await user.checkPassword(req.body.old)) {
        await userActions.updatePassword(user, req.body.new);
        return res.status(200).json({ result: "Password Updated" });
      } else {
        return res.status(401).json({ error: "Incorrect password" });
      }
    } else {
      return res.status(404).json({ error: "User does not exist" });
    }
  } else {
    return res.status(401).json({ error: "Request missing access token" });
  }
});

app.post(`/chattr/set-photo`, async (req, res) => {
  const token = req.headers.bearer;
  const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
  const user = await User.findById(userData.user);
  if (user) {
    const result = await userActions.setUserPhoto(user, req.body.photoURL);
    res.status(200).json({ result });
  } else {
    return res.status(404).json({ error: "User does not exist" });
  }
});
app.get(`/chattr/pending-users`, async (req, res) => {
  if (req.headers.bearer) {
    const token = req.headers.bearer;
    const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
    const user = await User.findById(userData.user);
    if (user) {
      if (user.role > 0) {
        const pendingUsers = await userActions.getUnactivatedUsers();
        return res.status(200).json({ pendingUsers });
      }
    } else {
      return res.status(404).json({ error: "User does not exist" });
    }
  } else {
    return res.status(401).json({ error: "Request missing access token" });
  }
});
app.get(`/chattr/blocked-users`, async (req, res) => {
  if (req.headers.bearer) {
    const token = req.headers.bearer;
    const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
    const user = await User.findById(userData.user);
    if (user) {
      if (user.role > 0) {
        const pendingUsers = await userActions.getUnactivatedUsers();
        return res.status(200).json({ pendingUsers });
      }
    } else {
      return res.status(404).json({ error: "User does not exist" });
    }
  } else {
    return res.status(401).json({ error: "Request missing access token" });
  }
});
app.post(`/chattr/confirm-user`, async (req, res) => {
  if (req.headers.bearer) {
    const token = req.headers.bearer;
    const userData = jwt.verify(token, process.env.JWT_SECRET_KEY);
    const user = await User.findById(userData.user);
    if (user) {
      if (user.role > 0) {
        const activationResult = await userActions.activateUser(
          req.body.userId
        );
        return res.status(200).json({ activationResult });
      }
    } else {
      return res.status(404).json({ error: "User does not exist" });
    }
  } else {
    return res.status(401).json({ error: "Request missing access token" });
  }
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
