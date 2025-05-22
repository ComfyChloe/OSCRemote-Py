const fs = require('fs');
const path = require('path');

class Logger {
    constructor(logPath) {
        this.logPath = logPath;
        this.logFile = path.join(logPath, `osc_relay_${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
        
        if (!fs.existsSync(logPath)) {
            fs.mkdirSync(logPath, { recursive: true });
        }
    }

    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${type}] ${message}\n`;

        fs.appendFileSync(this.logFile, logMessage);
    
        console.log(message);
    }
}

module.exports = new Logger(path.join(__dirname, 'logs'));
