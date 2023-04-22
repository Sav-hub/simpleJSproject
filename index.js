import {text} from "./data1.js"
// 
let show_text = document.getElementById("show_text_change");

show_text.onclick = () => {
    show_text.textContent = show_text.textContent + text;
}