const userActions = require("../src/mongo/actions/User");
const mongoose = require("mongoose");
const chai = require("chai");
const expect = chai.expect;
const chaiAsPromised = require("chai-as-promised");
const User = require("../src/mongo/models/User");
const { userData } = require("./data/users");
const { signToken, verifyToken } = require("../src/webtokens");
// let client1;
let receiver;
var io = require("socket.io-client");

const ioOptions = {
  transports: ["websocket"],
  forceNew: true,
  reconnection: false,
};
chai.use(chaiAsPromised);
let socketurl = "http://localhost:3005/";
describe("chat", function () {
  let user1;
  let user1jwt;

  before(async function () {
    // Start the server
    const server = require("../src/server");
    await server();
    await User.insertMany(userData);
    // Create jwts for test users
    user1 = await User.findOne({ username: "test1" });
    user1jwt = signToken(user1.id);
  });

  describe("Message Events", function () {
    it("Clients should receive a message when the `message` event is emited.", function (done) {
      const client1 = io(socketurl, {
        ...ioOptions,
        query: { token: user1jwt },
      });

      client1.on("connect", function (data) {
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
            "iid"
          );
          client1.disconnect();
          done();
        });
      });
    });
  });
  after(function (done) {
    mongoose.connection.db.dropDatabase(function () {
      mongoose.connection.close(done);
    });
  });
});
