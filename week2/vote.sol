// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Vote {
    // 후보 목록
    string[5] public candidates = ["a", "b", "c", "d", "e"];
    
    // 득표수
    mapping(string => uint) public votes;
    
    // 중복투표방지
    mapping(address => bool) public hasVoted;

    // 투표완료주소 및 시간기록
    struct VoterInfo {
        address voter;
        uint timestamp;
    }
    VoterInfo[] public voters;

    uint public startTime;
    uint public endTime;

    event Voted(address indexed voter, string candidate, uint time);

    // 투표시간 설정
    constructor(uint _delaySeconds, uint _durationSeconds) {
        startTime = block.timestamp + _delaySeconds;
        endTime = startTime + _durationSeconds;
    }
    
    // 투표 시간 확인 modifier
    modifier DuringVoting() {
        require(block.timestamp >= startTime, "Voting has not started");
        require(block.timestamp <= endTime, "Voting has already ended");
        _;
    }

    // 중복투표방지 modifier
    modifier UniqueVoter() {
        require(!hasVoted[msg.sender], "You have already voted");
        _;
    }

    // 투표 함수
    function vote(string memory candidate) public DuringVoting UniqueVoter {
        bool valid = false;
        for (uint i = 0; i < candidates.length; i++) {
            if (keccak256(bytes(candidates[i])) == keccak256(bytes(candidate))) {
                valid = true;
                break;
            }
        }
        require(valid, "Invalid candidate.");

        votes[candidate]++;
        hasVoted[msg.sender] = true;
        voters.push(VoterInfo(msg.sender, block.timestamp));

        emit Voted(msg.sender, candidate, block.timestamp);
    }

    // 투표 완료자 목록 반환
    function getVoter(uint index) public view returns (address, uint) {
        return (voters[index].voter, voters[index].timestamp);
    }

    // 전체 투표 완료자 수
    function getVoterCount() public view returns (uint) {
        return voters.length;
    }

    //결과 조회
    function getAllResults() public view returns (string[5] memory, uint[5] memory) {
        uint[5] memory result;
        for (uint i = 0; i < candidates.length; i++) {
            result[i] = votes[candidates[i]];
        }
        return (candidates, result);
    }

    // 우승자 반환
    function getWinner() public view returns (string memory winner, uint highestVotes) {
        uint maxVotes = 0;
        uint winnerIndex = 0;

        for (uint i = 0; i < candidates.length; i++) {
            if (votes[candidates[i]] > maxVotes) {
                maxVotes = votes[candidates[i]];
                winnerIndex = i;
            }
        }

        return (candidates[winnerIndex], votes[candidates[winnerIndex]]);
    }

}