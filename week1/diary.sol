// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Diary{
    enum Mood {good, normal, bad}
    struct DiaryEntry {
        string title;
        string content;
        Mood mood;
        uint timestamp;
    }
    mapping(address => DiaryEntry[]) private diaries;
    
    function writeDiary(string memory _title, string memory _content, Mood _mood) public {
        DiaryEntry memory entry = DiaryEntry(_title, _content, _mood, block.timestamp);
        diaries[msg.sender].push(entry);
    }
    
    function getDiary() public view returns (DiaryEntry[] memory) {
        return diaries[msg.sender];
    }

    function getDiariesByMood(Mood _mood) public view returns (DiaryEntry[] memory) {
        DiaryEntry[] memory all = diaries[msg.sender];
        uint count = 0;

        for (uint i = 0; i < all.length; i++) {
            if (all[i].mood == _mood) {
                count++;
            }
        }

        DiaryEntry[] memory filtered = new DiaryEntry[](count);
        uint index = 0;

        for (uint i = 0; i < all.length; i++) {
            if (all[i].mood == _mood) {
                filtered[index] = all[i];
                index++;
            }
        }

        return filtered;
    }
}