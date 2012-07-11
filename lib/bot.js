var net = require("net");
var EventEmitter = require("events").EventEmitter;
var vm = require("vm");
var readline = require('readline');
var rl;
var Stream = require('stream');

var defaultOptions = {
    "nick": "Buttercup",
    "altNick": "Buttercup`",
    "port": 6667,
    "useSSL": false,
    "encoding": "utf-8",
    "user": "buttercup",
    "realName": "Buttercup, a Node.js bot. Get it here: https://github.com/kestereverts/buttercup"
};

function mergeOptions(defaults, options) {
    var newOptions = {};
    for(var option in defaults) {
        newOptions[option] = defaults[option];
    }
    for(var option in options) {
        newOptions[option] = options[option];
    }
    return newOptions;
}

function Bot(options) {
    this.options = mergeOptions(defaultOptions, options);
    this._connecting = false;
    this._connected = true;
    this._modules = {};
    this._nick = this.options.nick;
}

Bot.prototype = new EventEmitter();

Bot.prototype.connect = function() {
    var me = this;
    if(this._connecting || this._connected) {
        return;
    }
    this._connecting = true;
    this._socket = new (require("./clientsocket"))(this.options);
    
    this._socket.on("connected", function() {
        me._connecting = false;
        me._connected = true;
        me.emit("connected");
    });
    
    this._socket.on("error", function() {
        me._connecting = false;
        me.emit("connectionError");
    });
    
    this._socket.on("nickInUse", function() {
        me._connecting = false;
        me.emit("nickInUse");
    });
    
    this._socket.on("data", function(data) {
        
    });
    
    this._socket.connect();
}

Buttercup.prototype.send = function(message) {
    message = String(message);
    message = message.replace(/\r|\n/g, "") + "\r\n";
    this.socket.write(message);
    //console.log(message);
}

Buttercup.prototype.loadModule = function(moduleName) {
    var rModuleName = require.resolve(moduleName);
    if(rModuleName in this.modules) {
        return false;
    }
    var mod = this.modules[rModuleName] = require(rModuleName);
    mod.load(this);
    return mod;
}

Buttercup.prototype.unloadModule = function(moduleName) {
    var rModuleName = require.resolve(moduleName);
    if(!(rModuleName in this.modules)) {
        return false;
    }
    this.modules[rModuleName].unload(this);
    delete this.modules[rModuleName];
    return true;
}

Buttercup.prototype.reloadModule = function(moduleName) {
    this.unloadModule(moduleName);
    var rModuleName = require.resolve(moduleName);
    delete require.cache[rModuleName];
    return this.loadModule(moduleName);
}

Buttercup.prototype.getChannelStream = function(channel) {
    return new ChannelStream(this, channel);
}

Buttercup.prototype.findStream = function(stream) {
    if(stream[0] == "#") {
        return this.getChannelStream(stream);
    }
    for(var rModuleName in this.modules) {
        if("streams" in this.modules[rModuleName] && stream in this.modules[rModuleName].streams) {
            return this.modules[rModuleName].streams[stream];
        }
    }
}

function ChannelStream(bot, channel) {
    this.readable = true;
    this.boundOnData = this.onData.bind(this);
    this.bot = bot;
    this.paused = false;
    this.channel = channel;
    this.writable = true;
    bot.on("PRIVMSG", this.boundOnData);
}

ChannelStream.prototype = new Stream();

ChannelStream.prototype.onData = function(message) {
    if(!this.paused && message.params[0] == this.channel) {
        this.emit("data", new Buffer(message.params[1] + "\r\n"));
    }
}
ChannelStream.prototype.setEncoding = function() {};
ChannelStream.prototype.pause = function() {
    this.paused = true;
}
ChannelStream.prototype.resume = function() {
    this.paused = false;
}

ChannelStream.prototype.write = ChannelStream.prototype.end = function(string) {
    if(Buffer.isBuffer(string)) {
        string = string.toString("utf-8");
    }
    this.bot.send("PRIVMSG " + this.channel + " :" + string);
    //console.log("yep, sending: " + "PRIVMSG " + this.channel + " :" + string);
    return true;
}

function Message(message) {
    message = String(message);
    this.full = message;
    this.params = [];
    
    if(message.charAt(0) == ":") {
        var prefix = message.substr(0, message.indexOf(" "));
        this.prefix = new Prefix(prefix);
        message = message.substr(message.indexOf(" ") + 1);
    } else {
        this.prefix = void(0);
    }
    
    if(message.indexOf(" ") != -1) {
        this.command = message.substr(0, message.indexOf(" "));
        message = message.substr(message.indexOf(" ") + 1);
    } else {
        this.command = message;
        return;
    }
    
    do {
        if(message.charAt(0) == ":") {
            this.params.push(message.substr(1));
            message = "";
        } else {
            if(message.indexOf(" ") != -1) {
                this.params.push(message.substr(0, message.indexOf(" ")));
                message = message.substr(message.indexOf(" ") + 1);
            } else {
                this.params.push(message);
                message = "";
            }
        }
    } while(message.length != 0);
}

Message.prototype.toString = Message.prototype.valueOf = function() {
    return this.full;
}

function Prefix(prefix) {
    prefix = String(prefix);
    if(prefix.charAt(0) == ":") {
        prefix = String(prefix).substr(1);
    }
    this.full = prefix;
    
    var nickMatch = prefix.match(/[^@!]+/);
    if(nickMatch == null) {
        this.nick = this.serverName = "";
    } else {
        this.nick = this.serverName = nickMatch[0];
    }
    
    var userMatch = prefix.match(/![^@!]+/);
    if(userMatch == null) {
        this.user = "";
    } else {
        this.user = userMatch[0].substr(1);
    }
    
    var hostMatch = prefix.match(/@[^@!]+/);
    if(hostMatch == null) {
        this.host = "";
    } else {
        this.host = hostMatch[0].substr(1);
    }
}

Prefix.prototype.toString = Prefix.prototype.valueOf = function() {
    return this.full;
}

var sandboxWrap = function(context) {
    function say(message) {
        bot.send("PRIVMSG " + context.target + " :" + message);
    }
    say.second = function(err, arg2) {
        if(err) {
            say(err);
        } else {
            say(arg2);
        }
    };
    say.arg = function(echo, err) {
        if(typeof err == "undefined") {
            return function() {
                say(arguments[echo]);
            }
        }
        
        return function() {
            if(arguments[err]) {
                say(arguments[err]);
            } else {
                say(arguments[echo]);
            }
        }
    }
    return eval(context.command);
};


exports.Buttercup = Buttercup;

function defineSandbox(bot) {
    function Bot() {
        var thisBot = this;
        bot.on("message", function(message) {
            thisBot.emit("message", message)
            thisBot.emit(message.command, message);
        });
    }
    
    Bot.prototype = new EventEmitter();
    
    Bot.prototype.send = function(message) {
        bot.send(message);
    }
    
    
    function stringify() {
        return "I am a sandbox!";
    }
    
    
    return {
        bot: new Bot(),
        require: function(module) {
            return rrequire(module);
        },
        console: console,
        toString: stringify,
        valueOf: stringify
    };
}

var rrequire = function (module) {
    if(module.indexOf(".") != -1 || module.indexOf("/") != -1) {
        throw new Error("Not allowed men.");
    }
    if(module == "fs" || module == "path" || module == "child_process" || module == "cluster") {
        throw new Error("Not allowed men.");
    } else {
        return require(module);
    }
}