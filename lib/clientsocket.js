var net = require("net");

function Socket(options) {
    this.options = options;
    this._socket = null;
}

Socket.prototype = new EventEmitter();

Socket.prototype.connect = (function connect() {
    var me = this;
    var options = this.options;
    var socket = this._socket = net.createConnection(options.port, options.host);
    socket.setEncoding(options.encoding);
    
    socket.on("connect", function() {
        me.emit("connect");
        me.send("NICK " + options.nick);
        me.send("USER " + options.user + " 8 * :" + options.realName);
    });
    
});

Socket.prototype.send = (function send(message) {
    message = String(message);
    message = message.replace(/\r|\n/g, "") + "\r\n";
    this._socket.write(message);
});

exports = Socket;