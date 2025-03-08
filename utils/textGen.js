const axios = require('axios');
const logger = require('./logger');

/**
 * Gera texto a partir de um modelo especificado.
 * @param {string} prompt - O texto que servirá de entrada para o modelo.
 * @param {string} model - O modelo a ser usado ('deepseek', 'qwen-2.5', 'grok').
 * @returns {Promise<string>} - O texto gerado ou mensagem de erro.
 */
async function generateText(prompt, model) {
    try {
        let apiUrl = '';
        let apiHeaders = {
            'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
            'Content-Type': 'application/json',
        };

        if (model === 'grok') {
            apiUrl = 'https://api.grok.ai/generate';
            apiHeaders = {
                'Authorization': `Bearer ${process.env.GROK_API_KEY}`,
                'Content-Type': 'application/json',
            };
        } else {
            apiUrl = `https://api-inference.huggingface.co/models/${model}`;
        }

        const response = await axios.post(
            apiUrl,
            { inputs: prompt },
            { headers: apiHeaders }
        );

        if (response.data && response.data[0] && response.data[0].generated_text) {
            return response.data[0].generated_text;
        } else {
            logger.warn(`Formato de resposta inesperado da API ${model}:`, response.data);
            return 'Desculpe, não consegui gerar um texto.';
        }
    } catch (error) {
        logger.error(`Erro ao gerar texto com ${model}:`, error.message);
        if (error.response) {
            logger.error(`Detalhes da resposta da API:`, error.response.data);
        }
        return 'Desculpe, ocorreu um erro ao gerar o texto.';
    }
}

/**
 * Gera texto utilizando o modelo Grok.
 * @param {string} prompt - O texto que servirá de entrada.
 * @returns {Promise<string>} - O texto gerado ou mensagem de erro.
 */
async function generateTextWithGrok(prompt) {
    return await generateText(prompt, 'grok');
}

/**
 * Gera texto utilizando o modelo DeepSeek.
 * @param {string} prompt - O texto que servirá de entrada.
 * @returns {Promise<string>} - O texto gerado ou mensagem de erro.
 */
async function generateTextWithDeepSeek(prompt) {
    return await generateText(prompt, 'deepseek-ai/DeepSeek-R1'); // Certifique-se de que este é o modelo correto.
}

/**
 * Gera texto utilizando o modelo Qwen 2.5.
 * @param {string} prompt - O texto que servirá de entrada.
 * @returns {Promise<string>} - O texto gerado ou mensagem de erro.
 */
async function generateTextWithQwen(prompt) {
    return await generateText(prompt, 'Qwen/Qwen2.5-VL-7B-Instruct'); // Certifique-se de que este é o modelo correto.
}

module.exports = { 
    generateTextWithDeepSeek, 
    generateTextWithQwen,
    generateTextWithGrok // Expor a função do Grok
};
