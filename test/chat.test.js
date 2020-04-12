const userActions = require("../src/mongo/actions/User");
const mongoose = require("mongoose");
const chai = require("chai");
const expect = chai.expect;
const chaiAsPromised = require("chai-as-promised");
const User = require("../src/mongo/models/User");
const { userData } = require("./data/users");
const { signToken, verifyToken } = require("../src/webtokens");
const server = require("../src/server");
var io = require("socket.io-client");
let chatServer;
const ioOptions = {
  transports: ["websocket"],
  forceNew: true,
  reconnection: false,
};
chai.use(chaiAsPromised);
let socketurl = "http://localhost:3005/";

const createConnectedSocketClient = (username) => {
  return new Promise((resolve, reject) => {
    User.findOne({ username }, function (err, user) {
      if (err) reject(err);
      userjwt = signToken(user.id);
      const client = io(socketurl, {
        ...ioOptions,
        query: { token: userjwt },
      });
      client.on("connect", function (connectData) {
        resolve({ client, user });
      });
    });
  });
};

const disconectClient = (client) => {
  return new Promise((resolve, reject) => {
    client.disconnect();
    client.on("disconnect", function () {
      resolve(true);
    });
    client.on("error", function (err) {
      reject(err);
    });
  });
};
describe("chat", function () {
  /* 
    For these tests, we need to mainting user/client division
    and generate JWTs for each user.
  */
  before(async function () {
    // Start the server

    chatServer = await server();
    console.log(userData);
    await User.insertMany(userData);
  });

  describe("Chat clients", function () {
    describe("connecting", function () {
      it("sends data back to a connected client.", async function () {
        const {
          client: client1,
          user: user1,
        } = await createConnectedSocketClient("test1");

        client1.on("user-connected", function (connectData) {
          expect(connectData).to.haveOwnProperty("user");
          expect(connectData).to.haveOwnProperty("chatHistory");
          expect(connectData.chatHistory).to.be.an("array");
          expect(connectData.user).to.have.keys(
            "username",
            "avatar",
            "socketId",
            "userId",
            "blockList",
            "blockedBy",
            "id",
            "iid",
            "accountStatus",
            "role"
          );
          client1.disconnect();
        });
      });
    });

    describe("messaging the room", function () {
      it("Emits messages sent by a user to the room.", async function () {
        const {
          client: client1,
          user: user1,
        } = await createConnectedSocketClient("test1");

        client1.emit("chat-message-sent", {
          message: "test",
          from: client1.id,
          fromUID: user1.id,
          isServerMessage: false,
        });
        client1.on("chat-message-broadcast", function (data) {
          if (data.id !== "system") {
            expect(data.message).to.eql("test");
            expect(data.fromUID).to.eql(user1.id);
            expect(data.from).to.eql(client1.id);
            client1.disconnect();
          }
        });
      });
    });
  });

  describe("messaging the room (secondary user)", function () {
    it("Emits messages sent by a user to the room (and other users see it).", async function () {
      const {
        client: client1,
        user: user1,
      } = await createConnectedSocketClient("test1");
      const {
        client: client2,
        user: user2,
      } = await createConnectedSocketClient("test2");

      client1.emit("chat-message-sent", {
        message: "lol",
        from: client1.id,
        fromUID: user1.id,
        isServerMessage: false,
      });
      client2.on("chat-message-broadcast", function (data) {
        if (data.id !== "system") {
          expect(data.user.username).to.eql(user1.username);
          expect(data.fromUID).to.eql(user1.id);
          client2.disconnect();
          client1.disconnect();
        }
      });
    });
  });

  describe("private messagig", function () {
    it("Emits a pm request.", async function () {
      const {
        client: client1,
        user: user1,
      } = await createConnectedSocketClient("test1");
      const {
        client: client2,
        user: user2,
      } = await createConnectedSocketClient("test2");
      client1.emit("private-chat-initiated", client2.id);
      client2.on("private-chat-initiated", function (data) {
        expect(data).to.be.a("string");
        client1.disconnect();
        client2.disconnect();
      });
    });

    it("Allows sendingn a 1-1 message.", async function () {
      const {
        client: client1,
        user: user1,
      } = await createConnectedSocketClient("test1");
      const {
        client: client2,
        user: user2,
      } = await createConnectedSocketClient("test2");

      client1.emit("private-chat-initiated", client2.id);
      client2.on("private-chat-initiated", function (data) {
        // hhere we'll get our room string (ie YdFlPepnPLCCyZQ3AAAE-GXqhrN9m5Me4GgJjAAAF)
        client1.emit("chat-message-sent", {
          message: "Hello, privately!",
          to: client2.id,
          toUID: user2.id,
          from: client1.id,
          fromUID: user1.id,
        });
      });
      client2.on("pm", (data) => {
        expect(data.message).to.eql("Hello, privately!");
        expect(data.toUID).to.eql(user2.id);
        client1.disconnect();
        client2.disconnect();
      });
    });
  });
  describe("user blocking", function () {
    it("Eallows users to block others", async function () {
      const {
        client: client1,
        user: user1,
      } = await createConnectedSocketClient("test1");
      const {
        client: client2,
        user: user2,
      } = await createConnectedSocketClient("test2");

      client1.emit("block-user", {
        userId: user2.id,
      });
      client2.on("block-user", function (data) {
        expect(data.blockedBy).to.be.an("array");
        // expect(data.fromUID).to.eql(user1.id);
        client2.disconnect();
        client1.disconnect();
      });
    });
  });
  describe("user unblocking", function () {
    it("allows users to unblock others", async function () {
      const {
        client: client1,
        user: user1,
      } = await createConnectedSocketClient("test1");
      const {
        client: client2,
        user: user2,
      } = await createConnectedSocketClient("test2");
      user1.blockedUsers = [];
      user1.blockedBy = [];
      user1.blockedUsers.push(user2.id);

      await user1.save();
      user2.blockedUsers = [];
      user2.blockedBy = [];
      user2.blockedBy.push(user1.id);
      await user2.save();
      debugger;
      client1.emit("unblock-user", user2.id);
      client2.on("unblock-user", function (data) {
        console.log("p????");
        debugger;
        expect(data.user.username).to.eql(user1.username);
        expect(data.fromUID).to.eql(user1.id);
        client2.disconnect();
        client1.disconnect();
      });
    });
  });
  after(function (done) {
    mongoose.connection.db.dropDatabase(function () {
      // mongoose.connection.close(done);
      done();
    });
  });
});
