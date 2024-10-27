const express = require("express");
const app = express();

const sharp = require("sharp");

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const QOI = require('qoijs')
const zlib = require('zlib');
const b64TC = require('base64-transcode');
const { buffer } = require("stream/consumers");
const MAX_IMAGE_SIZE = 1024;

async function normalizeImage(inputPath, outputPath) {
    const image = sharp(inputPath);
    // Get metadata to determine the image dimensions
    const metadata = await image.metadata();
    const width = metadata.width;
    const height = metadata.height;

    // Calculate the scaling coefficients
    const coefficientWidth = width / MAX_IMAGE_SIZE;
    const coefficientHeight = height / MAX_IMAGE_SIZE;

    // If both coefficients are less than or equal to 1, no resizing is needed
    if (coefficientWidth <= 1 && coefficientHeight <= 1) {
        return;
    }

    let newWidth, newHeight;

    if (coefficientWidth >= coefficientHeight) {
        newWidth = MAX_IMAGE_SIZE;
        newHeight = Math.round(height / coefficientWidth);
    } else {
        newWidth = Math.round(width / coefficientHeight);
        newHeight = MAX_IMAGE_SIZE;
    }

    await image
        .toFormat(sharp.format.jpeg)
        .jpeg({
            quality: 100,
        })
        .resize(newWidth, newHeight)
        .toFile(outputPath);

    return outputPath;
}

async function GetColors3(image) {
    try {
        const metadata = await image.metadata();
        const imageBuffer = Buffer.alloc(metadata.width * metadata.height * 3);

        const rawData = await image.raw().toBuffer();

        let index = 0;
        for (let y = 0; y < metadata.height; y++) {
            for (let x = 0; x < metadata.width; x++) {
                // Calculate the position in the buffer
                const r = rawData[index]; // Red channel
                const g = rawData[index + 1]; // Green channel
                const b = rawData[index + 2]; // Blue channel

                // Store the pixel's RGB values in the imageBuffer array
                const pixelIndex = (y * metadata.width + x) * 3;
                imageBuffer[pixelIndex] = r;
                imageBuffer[pixelIndex + 1] = g;
                imageBuffer[pixelIndex + 2] = b;

                // Move to the next pixel (each pixel is 3 bytes: R, G, B)
                index += 3;
            }
        }
        const uint8Array = new Uint8Array(imageBuffer);

        return uint8Array; // return as Uint8Array
    } catch (error) {
        console.error("Error getting pixel data:", error);
    }
}

async function GetColors4(image) {
    try {
        const metadata = await image.metadata();
        const imageBuffer = Buffer.alloc(metadata.width * metadata.height * 4);

        const rawData = await image.raw().toBuffer();

        let index = 0;
        for (let y = 0; y < metadata.height; y++) {
            for (let x = 0; x < metadata.width; x++) {
                // Calculate the position in the buffer
                const r = rawData[index]; // Red channel
                const g = rawData[index + 1]; // Green channel
                const b = rawData[index + 2]; // Blue channel
                const a = rawData[index + 3]; // Alpha channel

                // Store the pixel's RGB values in the imageBuffer
                const pixelIndex = (y * metadata.width + x) * 3;
                imageBuffer[pixelIndex] = r;
                imageBuffer[pixelIndex + 1] = g;
                imageBuffer[pixelIndex + 2] = b;
                imageBuffer[pixelIndex + 3] = a;

                // Move to the next pixel (each pixel is 3 bytes: R, G, B)
                index += 4;
            }
        }
        const uint8Array = new Uint8Array(imageBuffer);

        return uint8Array; // return as Uint8Array
    } catch (error) {
        console.error("Error getting pixel data:", error);
    }
}

async function getPixelData(imagePath) {
    try {
        const image = sharp(imagePath);
        const metadata = await image.metadata();
        const channels = metadata.channels;
        return channels === 4 ? GetColors4(image) : GetColors3(image);
    } catch (error) {
        console.error("Error getting pixel data:", error);
    }
}

//https://github.com/Velover/Image-Data-Extractor/blob/master/ExtactImageData/ExtactImageData.cpp
function compressString(string) {
    try {

        const config = {
            level: 5, // integer 0 -> 9 where 0 is no compression and 9 is most compression
            strategy: 2 // "huffman_only", "fixed", "dynamic"
        };

        const compressed_string = zlib.deflate(string, { level: 5, strategy: 2 });
        const readable_string = compressed_string.toString('base64');

        return readable_string;

    } catch (error) {
        console.error("Error during compression:", error);
        return "Error";
    }
}

function qoiEncodeToReadableString(colorBuffer, width, height, channels) {
    const metadata = {
        width: width,
        height: height,
        channels: channels,
        colorspace: 1  
    };
    const compressedBuffer = QOI.encode(colorBuffer, metadata);
    const nodeBuffer = Buffer.from(compressedBuffer); 
    const encodedString = nodeBuffer.toString('base64');
   // const compressedString = compressString(encodedString);
   return encodedString;
}

async function compressImage(color_buffer, imagePath) {
    try {
    const image = sharp(imagePath);
    const metadata = await image.metadata();
    const channels = metadata.channels;

    const QOI_encoded_string = qoiEncodeToReadableString(color_buffer,metadata.width, metadata.height,channels)
    return QOI_encoded_string;
    } catch (error) {
        console.error("Error compressing image:", error);
    }
}

const downloadImage = async (url, filepath) => {
    try {
        const response = await axios({
            url,
            method: "GET",
            responseType: "stream",
        });

        const writer = fs.createWriteStream(filepath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on("finish", resolve);
            writer.on("error", reject);
        });
    } catch (error) {
        console.error("Error downloading the image:", error);
    }
};

app.get("/", async (req, res) => {
    if (req.query.imageparse) {
        const imageUrl = req.query.imageparse;
        console.log(imageUrl);

        const downloadFolder = path.resolve(__dirname, "images");
        const fileName = path.basename(imageUrl);
        const normalizedPath = path.resolve(
            downloadFolder,
            `normalized_${fileName}`,
        );

        if (!fs.existsSync(downloadFolder)) {
            fs.mkdirSync(downloadFolder);
        }

        let imagePath = path.resolve(downloadFolder, fileName);

        try {
            await downloadImage(imageUrl, imagePath);
            console.log("Image downloaded successfully!");
            imagePath = await normalizeImage(imagePath, normalizedPath);
            console.log("Image normalized successfully");
            let color_buffer = await getPixelData(imagePath);
            console.log("Pixel data extracted successfully");
            const base64CompressedBuffer = await compressImage(color_buffer, imagePath);
            res.send(base64CompressedBuffer);
            console.log("Sent");
            color_buffer = null;

            clearImageFolder(downloadFolder);
            
        } catch (error) {
            console.error("Error processing the image:", error);
            res.status(500).send("Error processing the image.");
        }
    } else {
        res.send("No Query Detected");
    }
});

function clearImageFolder(folderPath) {
    fs.readdir(folderPath, (err, files) => {
        if (err) {
            console.error("Error reading the image folder:", err);
            return;
        }
        files.forEach(file => {
            const filePath = path.join(folderPath, file);
            fs.unlink(filePath, (err) => {
                if (err) {
                    console.error(`Error deleting file ${filePath}:`, err);
                }
            });
        });
    });
}

app.listen(3000);
