// utils/logger.js

const { createLogger, format, transports } = require('winston');

const logger = createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp(),
        format.json()
    ),
    transports: [
        new transports.Console(),  // Para log no console
        new transports.File({ filename: 'logs/error.log', level: 'error' }), // Log de erro
        new transports.File({ filename: 'logs/all.log' }),  // Log de todas as informações
    ],
});

module.exports = logger;