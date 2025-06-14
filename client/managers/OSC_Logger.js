const fs = require('fs');
const path = require('path');

class OSC_Logger {
    constructor(logDir = 'logs/osc') {
        this.logDir = logDir;
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        this.logFile = path.join(logDir, `osc_events_${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
    }

    logEvent({ direction, sender, receiver, param, value, user, timestamp = new Date() }) {
        const entry = {
            time: timestamp.toISOString(),
            direction,
            sender,
            receiver,
            param,
            value,
            user
        };
        fs.appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
        console.log(`[OSC] ${entry.time} | ${direction.toUpperCase()} | ${param} | Value: ${JSON.stringify(value)} | From: ${sender} | To: ${receiver} | User: ${user || ''}`);
    }
}

module.exports = new OSC_Logger();
