const axios = require('axios');
const logger = require('../utils/logger');

module.exports = {
    command: 'traduzir',
    description: 'Traduz texto para o português.',
    
    execute: async (text, message) => {
        try {
            const response = await axios.post(
                'https://api-inference.huggingface.co/models/Helsinki-NLP/opus-mt-en-pt',
                { inputs: text },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
            await message.reply(`🌐 Tradução: ${response.data[0].translation_text}`);
        } catch (error) {
            logger.error('Erro ao traduzir texto:', error.message);
            await message.reply('Desculpe, não consegui traduzir o texto.');
        }
    },
};