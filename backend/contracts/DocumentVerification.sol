// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract DocumentVerification {
    struct Document {
        string certificateNumber;
        string documentHash;
        uint256 timestamp;
        bool exists;
    }
    
    mapping(string => Document) public documents;
    
    event DocumentRegistered(
        string certificateNumber,
        string documentHash,
        uint256 timestamp
    );
    
    function registerDocument(
        string memory _certificateNumber,
        string memory _documentHash
    ) public {
        require(!documents[_certificateNumber].exists, "Certificate number already exists");
        
        documents[_certificateNumber] = Document({
            certificateNumber: _certificateNumber,
            documentHash: _documentHash,
            timestamp: block.timestamp,
            exists: true
        });
        
        emit DocumentRegistered(_certificateNumber, _documentHash, block.timestamp);
    }
    
    function verifyDocument(
        string memory _certificateNumber,
        string memory _documentHash
    ) public view returns (bool, uint256) {
        Document memory doc = documents[_certificateNumber];
        
        if (!doc.exists) {
            return (false, 0);
        }
        
        bool isValid = keccak256(abi.encodePacked(doc.documentHash)) == 
                       keccak256(abi.encodePacked(_documentHash));
        
        return (isValid, doc.timestamp);
    }
    
    function getDocument(string memory _certificateNumber) 
        public 
        view 
        returns (string memory, string memory, uint256, bool) 
    {
        Document memory doc = documents[_certificateNumber];
        return (doc.certificateNumber, doc.documentHash, doc.timestamp, doc.exists);
    }
}