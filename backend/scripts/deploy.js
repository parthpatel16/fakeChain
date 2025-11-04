const hre = require("hardhat");

async function main() {
  console.log("Deploying DocumentVerification contract...");

  const DocumentVerification = await hre.ethers.getContractFactory("DocumentVerification");
  const documentVerification = await DocumentVerification.deploy();

  await documentVerification.waitForDeployment();

  const address = await documentVerification.getAddress();
  console.log("DocumentVerification deployed to:", address);
  
  // Save the contract address
  const fs = require('fs');
  fs.writeFileSync(
    'contract-address.txt',
    address
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });