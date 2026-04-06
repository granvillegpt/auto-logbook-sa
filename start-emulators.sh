#!/bin/bash
pkill -9 -f firebase
pkill -9 -f node
pkill -9 -f java
sleep 1
firebase emulators:start --only firestore,functions
