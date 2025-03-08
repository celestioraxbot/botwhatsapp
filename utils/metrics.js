// utils/metrics.js
let totalSales = 0;
let messageCount = 0;
let commandCount = 0;

function incrementSales() {
    totalSales++;
}

function getTotalSales() {
    return totalSales;
}

function logMessage() {
    messageCount++;
}

function getMessageCount() {
    return messageCount;
}

function logCommand() {
    commandCount++;
}

function getCommandCount() {
    return commandCount;
}

module.exports = {
    incrementSales,
    getTotalSales,
    logMessage,
    getMessageCount,
    logCommand,
    getCommandCount,
};