const { ethers } = require("ethers");
const fs = require('fs');

class BlockchainService {
  constructor() {
    this.provider = null;
    this.signer = null;
    this.contract = null;
  }

  async initialize() {
    try {
      // Connect to local Hardhat node
      this.provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
      
      // Get signer (first account from Hardhat node)
      this.signer = await this.provider.getSigner();
      
      // Read contract address
      const contractAddress = fs.readFileSync('contract-address.txt', 'utf8').trim();
      
      // Read ABI from artifacts
      const artifactPath = './artifacts/contracts/DocumentVerification.sol/DocumentVerification.json';
      const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
      
      // Create contract instance
      this.contract = new ethers.Contract(
        contractAddress,
        artifact.abi,
        this.signer
      );
      
      console.log("Blockchain service initialized successfully");
      return true;
    } catch (error) {
      console.error("Failed to initialize blockchain service:", error);
      return false;
    }
  }

  async registerDocument(certificateNumber, documentHash) {
    try {
      const tx = await this.contract.registerDocument(certificateNumber, documentHash);
      const receipt = await tx.wait();
      console.log("Document registered on blockchain:", receipt.hash);
      return { success: true, txHash: receipt.hash };
    } catch (error) {
      console.error("Error registering document:", error);
      return { success: false, error: error.message };
    }
  }

  async verifyDocument(certificateNumber, documentHash) {
    try {
      const [isValid, timestamp] = await this.contract.verifyDocument(certificateNumber, documentHash);
      return {
        success: true,
        isValid: isValid,
        timestamp: Number(timestamp)
      };
    } catch (error) {
      console.error("Error verifying document:", error);
      return { success: false, error: error.message };
    }
  }

  async getDocument(certificateNumber) {
    try {
      const [certNum, hash, timestamp, exists] = await this.contract.getDocument(certificateNumber);
      return {
        success: true,
        certificateNumber: certNum,
        documentHash: hash,
        timestamp: Number(timestamp),
        exists: exists
      };
    } catch (error) {
      console.error("Error getting document:", error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new BlockchainService();