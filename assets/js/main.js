    const topicInput = document.getElementById('topic-input');
    const difficultySelect = document.getElementById('difficulty-select');
    const studyForm = document.getElementById('study-form');
    const studiesList = document.getElementById('studies-list');


    studyForm.addEventListener('submit', (event) => {
        event.preventDefault();

        console.log(`Topic: ${topicInput.value} | Difficulty: ${difficultySelect.value}`);
    })